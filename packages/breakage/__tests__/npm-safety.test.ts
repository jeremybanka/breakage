import { execFileSync } from "node:child_process"
import { existsSync, linkSync, readFileSync } from "node:fs"
import path from "node:path"

import { afterEach, describe, expect, it } from "bun:test"

import { npmCheck, npmTest } from "../src/npm/check.ts"
import { withStage } from "../src/npm/environment.ts"
import { matches } from "../src/npm/manifest.ts"
import { supportChanges } from "../src/npm/release.ts"
import type { NpmFixture } from "../tests/public/npm-fixture.ts"
import {
	assertStagesRemoved,
	git,
	npmFixture,
} from "../tests/public/npm-fixture.ts"

let fixture: NpmFixture | undefined
afterEach(() => {
	fixture?.clean()
	fixture = undefined
})
function setup(): NpmFixture {
	fixture = npmFixture()
	return fixture
}

describe(`npm environment safety`, () => {
	it.each([`2.0.0`, `3.0.0`])(
		`isolates intended version %s from shared manifest storage`,
		async (version) => {
			const f = setup()
			f.representative(`next`, `2.0.0`, true)
			const original = f.read(`local-host/package.json`)
			f.write(`.cache/host-manifest.json`, original)
			linkSync(
				path.join(f.directory, `.cache/host-manifest.json`),
				path.join(f.directory, `.cache/other-environment.json`),
			)
			const archive = path.join(
				f.directory,
				f.config.localPeers!.host!.artifact,
			)
			const originalArchive = readFileSync(archive)
			f.config.installCommand += ` && rm node_modules/host/package.json && ln ../../../.cache/host-manifest.json node_modules/host/package.json`
			f.config.releaseIntent = () => ({ status: `release`, version })
			f.copy(
				new URL(
					`./fixtures/npm/environment/check-manifest-storage.ts`,
					import.meta.url,
				),
				`contracts/check.ts`,
			)
			f.config.suites.host!.command = `node contracts/check.ts ${version}`
			const result = await npmTest(
				f.config,
				{ peer: `host`, range: version },
				{ baseDirectory: f.directory },
			)
			expect(result.exitCode, JSON.stringify(result)).toBe(0)
			expect(result.representatives[0]!.peers.host).toMatchObject({
				version,
				archiveVersion: `2.0.0`,
				source: `candidate`,
			})
			expect(f.read(`.cache/host-manifest.json`)).toBe(original)
			expect(f.read(`.cache/other-environment.json`)).toBe(original)
			expect(f.read(`local-host/package.json`)).toBe(original)
			expect(readFileSync(archive)).toEqual(originalArchive)
			assertStagesRemoved(f, result)
		},
		30_000,
	)
	it(`restores installation inputs on a failed non-frozen command and preserves the Git index`, async () => {
		const f = setup()
		f.representative(`one`, `1.0.0`)
		f.baseline({ host: `^1 || ^2` })
		const original = f.read(`peer-environments/one/package-lock.json`)
		const index = readFileSync(path.join(f.directory, `.git/index`))
		f.config.prepareCommand = `printf changed > package-lock.json; exit 2`
		const result = await npmCheck(f.config, { baseDirectory: f.directory })
		expect(result.exitCode).toBe(2)
		expect(result.representatives[0]!.error).toContain(
			`restored the original inputs`,
		)
		expect(f.read(`peer-environments/one/package-lock.json`)).toBe(original)
		expect(readFileSync(path.join(f.directory, `.git/index`))).toEqual(index)
		assertStagesRemoved(f, result)
	}, 30_000)
	it(`detects stale installed versions even if frozen preparation repairs them`, async () => {
		const f = setup()
		f.representative(`one`, `1.0.0`)
		f.write(`peer-environments/one/node_modules/host/package.json`, {
			name: `host`,
			version: `1.9.0`,
		})
		const result = await npmCheck(f.config, {
			baseDirectory: f.directory,
			coverageOnly: true,
		})
		expect(result.exitCode).toBe(2)
		expect(result.representatives[0]!.error).toContain(`Stale installed host`)
		assertStagesRemoved(f, result)
	}, 30_000)
	it(`rejects stale candidate archives before any suite runs`, async () => {
		const f = setup()
		f.representative(`one`, `1.0.0`)
		f.write(`package.json`, {
			...JSON.parse(f.read(`package.json`)),
			peerDependencies: { host: `^1` },
		})
		const result = await npmCheck(f.config, { baseDirectory: f.directory })
		expect(result.exitCode).toBe(2)
		expect(result.representatives[0]!.error).toContain(
			`stale peer declarations`,
		)
		expect(result.representatives[0]!.suites[0]!.status).toBe(`not-run`)
		assertStagesRemoved(f, result)
	}, 30_000)
	it(`rejects a same-version shadow peer and a leaked workspace package instance`, async () => {
		const f = setup()
		f.representative(`one`, `1.0.0`)
		f.config.installCommand += ` && mkdir -p node_modules/integration/node_modules && cp -R ../node_modules/host node_modules/integration/node_modules/host`
		const result = await npmTest(
			f.config,
			{ peer: `host`, range: `1` },
			{ baseDirectory: f.directory },
		)
		expect(result.exitCode).toBe(2)
		expect(result.representatives[0]!.error).toContain(
			`different instance of host`,
		)
		assertStagesRemoved(f, result)
	}, 30_000)
	it(`runs a packed runtime dependency while preserving the chosen host instance`, async () => {
		const f = setup()
		f.representative(`one`, `1.0.0`)
		f.write(`helper/package.json`, {
			name: `helper`,
			version: `1.0.0`,
			main: `index.js`,
			type: `module`,
			peerDependencies: { host: `*` },
			files: [`index.js`],
		})
		f.compile(
			new URL(`./fixtures/npm/environment/helper.ts`, import.meta.url),
			`helper/index.js`,
		)
		const helper = f.pack(`helper`)
		f.write(`package.json`, {
			...JSON.parse(f.read(`package.json`)),
			dependencies: { helper: `file:${path.join(f.directory, helper)}` },
		})
		f.compile(
			new URL(
				`./fixtures/npm/environment/integration-with-helper.ts`,
				import.meta.url,
			),
			`index.js`,
		)
		f.config.artifact = f.pack(`.`)
		const result = await npmTest(
			f.config,
			{ peer: `host`, range: `1` },
			{ baseDirectory: f.directory },
		)
		expect(result.exitCode, JSON.stringify(result)).toBe(0)
		assertStagesRemoved(f, result)
	}, 30_000)
	it.each([false, true])(
		`audits installed optional runtime dependencies (shadow peer: %s)`,
		async (shadow) => {
			const f = setup()
			f.representative(`next`, `2.0.0`, true)
			f.config.releaseIntent = () => ({ status: `release`, version: `2.0.0` })
			f.write(`helper/package.json`, {
				name: `helper`,
				version: `1.0.0`,
				main: `index.js`,
				type: `module`,
				peerDependencies: { host: `*` },
				files: [`index.js`],
			})
			f.compile(
				new URL(`./fixtures/npm/environment/helper.ts`, import.meta.url),
				`helper/index.js`,
			)
			const helper = f.pack(`helper`)
			f.write(`package.json`, {
				...JSON.parse(f.read(`package.json`)),
				optionalDependencies: {
					helper: `file:${path.join(f.directory, helper)}`,
				},
			})
			f.config.artifact = f.pack(`.`)
			// Confirm npm installed the optional package; its branch must be audited
			// even when the current contract does not happen to execute that branch.
			f.config.installCommand += ` && test -f node_modules/helper/package.json`
			if (shadow)
				f.config.installCommand += ` && mkdir -p node_modules/helper/node_modules && cp -R node_modules/host node_modules/helper/node_modules/host`
			const result = await npmTest(
				f.config,
				{ peer: `host`, range: `2` },
				{ baseDirectory: f.directory },
			)
			expect(result.exitCode, JSON.stringify(result)).toBe(shadow ? 2 : 0)
			if (shadow) {
				expect(result.representatives[0]!.error).toContain(
					`Runtime dependency helper resolves a different instance of host`,
				)
				expect(result.representatives[0]!.suites[0]!.status).toBe(`not-run`)
			}
			assertStagesRemoved(f, result)
		},
		30_000,
	)
	it.each([false, true])(
		`permits omitted optional runtime dependencies (also declared required: %s)`,
		async (overridesRequired) => {
			const f = setup()
			f.representative(`one`, `1.0.0`)
			const dependency = {
				helper: `file:${path.join(f.directory, `missing-helper.tgz`)}`,
			}
			f.write(`package.json`, {
				...JSON.parse(f.read(`package.json`)),
				...(overridesRequired ? { dependencies: dependency } : {}),
				optionalDependencies: dependency,
			})
			f.config.artifact = f.pack(`.`)
			f.config.installCommand += ` --omit=optional`
			const result = await npmTest(
				f.config,
				{ peer: `host`, range: `1` },
				{ baseDirectory: f.directory },
			)
			expect(result.exitCode, JSON.stringify(result)).toBe(0)
			assertStagesRemoved(f, result)
		},
		30_000,
	)
	it(`rejects an installed optional runtime dependency with a missing manifest`, async () => {
		const f = setup()
		f.representative(`one`, `1.0.0`)
		f.write(`helper/package.json`, {
			name: `helper`,
			version: `1.0.0`,
			main: `index.js`,
			files: [`index.js`],
		})
		f.compile(
			new URL(`./fixtures/npm/environment/empty-helper.ts`, import.meta.url),
			`helper/index.js`,
		)
		const helper = f.pack(`helper`)
		f.write(`package.json`, {
			...JSON.parse(f.read(`package.json`)),
			optionalDependencies: {
				helper: `file:${path.join(f.directory, helper)}`,
			},
		})
		f.config.artifact = f.pack(`.`)
		f.config.installCommand += ` && rm node_modules/helper/package.json`
		const result = await npmTest(
			f.config,
			{ peer: `host`, range: `1` },
			{ baseDirectory: f.directory },
		)
		expect(result.exitCode, JSON.stringify(result)).toBe(2)
		expect(result.representatives[0]!.error).toContain(`helper/package.json`)
		expect(result.representatives[0]!.suites[0]!.status).toBe(`not-run`)
		assertStagesRemoved(f, result)
	}, 30_000)
	it(`keeps coupled formulations intact and runs each configured relationship suite`, async () => {
		const f = setup()
		f.representative(`one`, `1.0.0`)
		f.write(`renderer/package.json`, {
			name: `renderer`,
			version: `19.0.0`,
			main: `index.js`,
			type: `module`,
			files: [`index.js`],
		})
		f.compile(
			new URL(`./fixtures/npm/environment/renderer.ts`, import.meta.url),
			`renderer/index.js`,
		)
		const archive = f.pack(`renderer`)
		f.write(`package.json`, {
			...JSON.parse(f.read(`package.json`)),
			peerDependencies: { host: `^1`, renderer: `^19` },
		})
		f.config.artifact = f.pack(`.`)
		const env = JSON.parse(f.read(`peer-environments/one/package.json`))
		env.dependencies.renderer = `19.0.0`
		f.write(`peer-environments/one/package.json`, env)
		const lock = JSON.parse(f.read(`peer-environments/one/package-lock.json`))
		lock.packages[``].dependencies = env.dependencies
		lock.packages[`node_modules/renderer`] = {
			version: `19.0.0`,
			resolved: `file:../../${archive}`,
		}
		f.write(`peer-environments/one/package-lock.json`, lock)
		f.copy(
			new URL(`./fixtures/npm/environment/check-renderer.ts`, import.meta.url),
			`contracts/renderer.ts`,
		)
		f.config.suites.renderer = {
			files: [`contracts/renderer.ts`],
			command: `node contracts/renderer.ts`,
		}
		const result = await npmCheck(f.config, { baseDirectory: f.directory })
		expect(result.exitCode, JSON.stringify(result)).toBe(0)
		expect(result.representatives).toHaveLength(1)
		expect(result.representatives[0]!.suites.map((s) => s.status)).toEqual([
			`passed`,
			`passed`,
		])
		expect(result.coverage).toHaveLength(2)
	}, 30_000)
	it(`rejects overlapping stage ownership and never deletes the active owner's files`, async () => {
		const f = setup()
		f.representative(`one`, `1.0.0`)
		const directory = path.join(f.directory, `peer-environments/one`)
		await withStage(directory, async () => {
			f.write(`peer-environments/one/test/owner.txt`, `active`)
			const collision = await npmTest(
				f.config,
				{ representative: `peer-environments/one` },
				{ baseDirectory: f.directory },
			)
			expect(collision.exitCode).toBe(2)
			expect(f.read(`peer-environments/one/test/owner.txt`)).toBe(`active`)
		})
		expect(existsSync(path.join(directory, `test`))).toBe(false)
	}, 30_000)
	it(`rejects tracked stages even if an ignore rule also matches`, async () => {
		const f = setup()
		f.representative(`one`, `1.0.0`)
		f.write(`peer-environments/one/test/precious.txt`, `tracked`)
		git(f.directory, `add`, `-f`, `peer-environments/one/test/precious.txt`)
		const result = await npmCheck(f.config, { baseDirectory: f.directory })
		expect(result.exitCode).toBe(2)
		expect(f.read(`peer-environments/one/test/precious.txt`)).toBe(`tracked`)
	}, 30_000)
	it(`fetches a release manifest from an actual local origin`, async () => {
		const f = setup()
		f.representative(`one`, `1.0.0`)
		f.representative(`two`, `2.0.0`)
		f.baseline({ host: `^1 || ^2 || ^3` })
		const remote = path.join(f.directory, `remote.git`)
		execFileSync(`git`, [`init`, `--bare`, remote], { stdio: `ignore` })
		git(f.directory, `remote`, `add`, `origin`, remote)
		git(f.directory, `push`, `origin`, `--tags`)
		f.config.baseline = { tagPattern: `refs/tags/integration@` }
		const result = await npmCheck(f.config, {
			baseDirectory: f.directory,
			coverageOnly: true,
		})
		expect(result.exitCode, JSON.stringify(result)).toBe(1)
		expect(result.support.status).toBe(`end-of-support`)
	}, 30_000)
	it(`supports repository policy for a pre-1.0 breaking minor release`, async () => {
		const f = setup()
		f.representative(`one`, `1.0.0`)
		f.representative(`two`, `2.0.0`)
		f.baseline({ host: `^1 || ^2 || ^3` })
		const current = JSON.parse(f.read(`package.json`))
		f.write(`package.json`, { ...current, version: `0.5.0` })
		git(f.directory, `add`, `package.json`)
		git(f.directory, `commit`, `-m`, `Pre-1.0 release`)
		f.write(`package.json`, {
			...current,
			version: `0.5.0`,
			peerDependencies: { host: `^1` },
		})
		const snapshot = JSON.parse(f.read(`.breakage/baseline.json`))
		snapshot.commit = git(f.directory, `rev-parse`, `HEAD`).trim()
		f.write(`.breakage/baseline.json`, snapshot)
		f.config.releaseIntent = ({ packageName }) =>
			packageName === `integration`
				? { status: `release`, version: `0.6.0` }
				: { status: `none` }
		f.config.certifyBreaking = ({ previousVersion, release }) =>
			previousVersion.startsWith(`0.`) && release.delta === `minor`
		const result = await npmCheck(f.config, {
			baseDirectory: f.directory,
			coverageOnly: true,
		})
		expect(result.exitCode, JSON.stringify(result)).toBe(0)
		expect(result.support.status).toBe(`certified`)
	}, 30_000)
})

describe(`declaration semantics`, () => {
	it(`requires exact preview enrollment and keeps previews out of broad ranges`, () => {
		expect(matches(`2.0.0-beta.1`, `2.0.0-beta.1 || ^2`)).toBe(true)
		expect(matches(`2.0.0-beta.1`, `^2`)).toBe(false)
		expect(matches(`2.0.0-beta.1`, `>=2.0.0-beta.1 <3`)).toBe(false)
		expect(matches(`2.0.0-beta.2`, `2.0.0-beta.1`)).toBe(false)
	})
	it(`recognizes a new required peer even with a wildcard and permits removing a requirement`, () => {
		const identity = { name: `integration`, version: `1.0.0` }
		expect(
			supportChanges(identity, {
				...identity,
				peerDependencies: { host: `*` },
			}),
		).toHaveLength(1)
		expect(
			supportChanges(
				{ ...identity, peerDependencies: { host: `^1` } },
				identity,
			),
		).toEqual([])
	})
	it(`detects making an optional peer required without requiring absence cases`, () => {
		const manifest = {
			name: `integration`,
			version: `1.0.0`,
			peerDependencies: { host: `^1` },
		}
		expect(
			supportChanges(
				{ ...manifest, peerDependenciesMeta: { host: { optional: true } } },
				manifest,
			)[0]!.reason,
		).toBe(`required-peer`)
		expect(
			supportChanges(manifest, {
				...manifest,
				peerDependenciesMeta: { host: { optional: true } },
			}),
		).toEqual([])
	})
})
