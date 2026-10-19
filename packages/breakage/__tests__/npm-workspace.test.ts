import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"

import { afterEach, describe, expect, it } from "bun:test"

import { npmCheck, npmTest } from "../src/npm/check.ts"
import { previousManifest } from "../src/npm/release.ts"
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

describe(`authored support eras`, () => {
	it.each([`workspace:`, `workspace:*`, `workspace:^`, `workspace:~`])(
		`rejects moving current declaration %s before preparation`,
		async (range) => {
			const f = setup()
			f.representative(`one`, `1.0.0`)
			f.write(`package.json`, {
				...JSON.parse(f.read(`package.json`)),
				peerDependencies: { host: range },
				peerDependenciesMeta: { host: { optional: true } },
			})
			f.config.prepareCommand = `touch prepared`
			const result = await npmCheck(f.config, {
				baseDirectory: f.directory,
				coverageOnly: true,
			})
			expect(result.exitCode).toBe(2)
			expect(result.errors.join()).toContain(`explicit support eras`)
			expect(result.errors.join()).toContain(`host: ${range} in integration`)
			expect(result.representatives).toEqual([])
			expect(
				existsSync(path.join(f.directory, `peer-environments/one/prepared`)),
			).toBe(false)
		},
		30_000,
	)
	it(`uses fixed workspace ranges consistently for execution, coverage, optionality, and support comparison`, async () => {
		const f = setup()
		f.representative(`one`, `1.0.0`)
		f.representative(`two`, `2.0.0`)
		const packed = {
			...JSON.parse(f.read(`package.json`)),
			peerDependenciesMeta: { host: { optional: true } },
		}
		f.write(`package.json`, packed)
		f.config.artifact = f.pack(`.`)
		f.write(`package.json`, {
			...packed,
			peerDependencies: { host: `workspace:^1 || ^2` },
		})
		f.baseline({ host: `workspace:^1 || ^2` })
		// Fixed ranges require no lookup of today's or the historical local version.
		f.config.localPeers = {}
		const result = await npmCheck(f.config, { baseDirectory: f.directory })
		expect(result.exitCode, JSON.stringify(result)).toBe(0)
		expect(result.support.status).toBe(`unchanged`)
		expect(result.coverage.map((entry) => entry.era)).toEqual([`^1`, `^2`])
		expect(result.representatives.map((entry) => entry.status)).toEqual([
			`passed`,
			`passed`,
		])
		expect(JSON.parse(f.read(`package.json`)).peerDependencies.host).toBe(
			`workspace:^1 || ^2`,
		)
		assertStagesRemoved(f, result)
	}, 30_000)
	it.each([`workspace:../host`, `workspace:other@*`])(
		`rejects unsupported current syntax %s explicitly`,
		async (range) => {
			const f = setup()
			f.write(`package.json`, {
				...JSON.parse(f.read(`package.json`)),
				peerDependencies: { host: range },
			})
			const result = await npmCheck(f.config, { baseDirectory: f.directory })
			expect(result.exitCode).toBe(2)
			expect(result.errors.join()).toContain(
				`Unsupported workspace peer range for host: ${range}`,
			)
		},
		30_000,
	)
	it(`requires explicit eras in coordinated peer candidates too`, async () => {
		const f = setup()
		f.representative(`next`, `2.0.0`, true)
		f.write(`local-host/package.json`, {
			...JSON.parse(f.read(`local-host/package.json`)),
			peerDependencies: { helper: `workspace:^` },
		})
		f.config.releaseIntent = () => ({ status: `release`, version: `2.0.0` })
		const result = await npmTest(
			f.config,
			{ peer: `host`, range: `2` },
			{ baseDirectory: f.directory },
		)
		expect(result.exitCode).toBe(2)
		expect(result.representatives[0]!.error).toContain(
			`helper: workspace:^ in host`,
		)
		assertStagesRemoved(f, result)
	}, 30_000)
	it(`checks normalized coordinated peer declarations against their archives`, async () => {
		const f = setup()
		f.representative(`next`, `2.0.0`, true)
		f.write(`local-host/package.json`, {
			...JSON.parse(f.read(`local-host/package.json`)),
			peerDependencies: { helper: `^1` },
			peerDependenciesMeta: { helper: { optional: true } },
		})
		f.config.localPeers!.host!.artifact = f.pack(`local-host`)
		const authored = JSON.parse(f.read(`local-host/package.json`))
		f.write(`local-host/package.json`, {
			...authored,
			peerDependencies: { helper: `workspace:^1` },
		})
		f.config.releaseIntent = () => ({ status: `release`, version: `2.0.0` })
		const selected = { peer: `host`, range: `2` }
		const options = { baseDirectory: f.directory }
		const result = await npmTest(f.config, selected, options)
		expect(result.exitCode, JSON.stringify(result)).toBe(0)
		f.write(`local-host/package.json`, {
			...authored,
			peerDependencies: { helper: `workspace:^2` },
		})
		const stale = await npmTest(f.config, selected, options)
		expect(stale.exitCode).toBe(2)
		expect(stale.representatives[0]!.error).toContain(
			`stale peer declarations; rebuild and pack host`,
		)
		assertStagesRemoved(f, stale)
	}, 30_000)
})

describe(`historical workspace declarations`, () => {
	it.each([
		[`workspace:`, `0.53.3`],
		[`workspace:*`, `0.53.3`],
		[`workspace:^`, `^0.53.3`],
		[`workspace:~`, `~0.53.3`],
	])(
		`resolves %s at the baseline commit`,
		async (range, expected) => {
			const f = setup()
			f.write(`package.json`, {
				...JSON.parse(f.read(`package.json`)),
				peerDependenciesMeta: { host: { optional: true } },
			})
			f.write(`local-host/package.json`, { name: `host`, version: `0.53.3` })
			f.baseline({ host: range })
			f.write(`local-host/package.json`, { name: `host`, version: `0.99.0` })
			f.config.releaseIntent = () => {
				throw new Error(`Historical resolution must not consult release intent`)
			}
			const previous = await previousManifest(f.config, f.directory)
			expect(previous!.peerDependencies).toEqual({ host: expected })
			expect(previous!.peerDependenciesMeta).toEqual({
				host: { optional: true },
			})
			expect(JSON.parse(f.read(`local-host/package.json`)).version).toBe(
				`0.99.0`,
			)
		},
		30_000,
	)
	it(`detects and certifies dropped historical support independently of today's local version`, async () => {
		const f = setup()
		f.baseline({ host: `workspace:^` })
		f.write(`local-host/package.json`, { name: `host`, version: `3.0.0` })
		f.write(`package.json`, {
			...JSON.parse(f.read(`package.json`)),
			peerDependencies: { host: `^3` },
		})
		f.representative(`three`, `3.0.0`)
		f.config.releaseIntent = () => ({ status: `release`, version: `2.0.0` })
		const options = { baseDirectory: f.directory, coverageOnly: true }
		const result = await npmCheck(f.config, options)
		expect(result.exitCode, JSON.stringify(result)).toBe(1)
		expect(result.support.status).toBe(`end-of-support`)
		expect(result.support.changes).toEqual([
			{
				peer: `host`,
				reason: `narrowed-range`,
				previous: `^2.0.0`,
				current: `^3`,
			},
		])
		f.config.certifyBreaking = ({ changes, release }) =>
			changes[0]!.previous === `^2.0.0` && release.delta === `major`
		const certified = await npmCheck(f.config, options)
		expect(certified.exitCode, JSON.stringify(certified)).toBe(0)
		expect(certified.support.status).toBe(`certified`)
		assertStagesRemoved(f, certified)
	}, 30_000)
	it(`reads a sibling peer at a fetched release tag from a nested package`, async () => {
		const f = setup()
		f.write(`packages/integration/package.json`, {
			name: `integration`,
			version: `1.0.0`,
			peerDependencies: { host: `workspace:^` },
		})
		f.write(`packages/core/package.json`, { name: `host`, version: `1.2.3` })
		f.baseline({ host: `^1` })
		const remote = path.join(f.directory, `remote.git`)
		execFileSync(`git`, [`init`, `--bare`, remote], { stdio: `ignore` })
		git(f.directory, `remote`, `add`, `origin`, remote)
		git(f.directory, `push`, `origin`, `--tags`)
		f.config.baseline = { tagPattern: `refs/tags/integration@` }
		f.config.localPeers!.host!.directory = `../core`
		f.write(`packages/core/package.json`, { name: `host`, version: `9.0.0` })
		const previous = await previousManifest(
			f.config,
			path.join(f.directory, `packages/integration`),
		)
		expect(previous!.peerDependencies).toEqual({ host: `^1.2.3` })
	}, 30_000)
	it.each([
		[`unregistered`, `needs a localPeers directory`],
		[`missing`, `missing/package.json`],
		[`mismatched`, `identity mismatch for host`],
		[`invalid-version`, `Invalid package identity`],
		[`outside`, `escapes the release repository`],
	])(
		`rejects %s historical peer evidence`,
		async (scenario, expected) => {
			const f = setup()
			if (scenario === `mismatched`)
				f.write(`local-host/package.json`, { name: `other`, version: `2.0.0` })
			if (scenario === `invalid-version`)
				f.write(`local-host/package.json`, { name: `host`, version: `invalid` })
			f.baseline({ host: `workspace:^` })
			// Valid current data must not repair missing or invalid historical evidence.
			f.write(`local-host/package.json`, { name: `host`, version: `2.0.0` })
			if (scenario === `unregistered`) f.config.localPeers = {}
			if (scenario === `missing`) {
				f.config.localPeers!.host!.directory = `missing`
				f.write(`missing/package.json`, { name: `host`, version: `2.0.0` })
			}
			if (scenario === `outside`) f.config.localPeers!.host!.directory = `..`
			await assert.rejects(
				previousManifest(f.config, f.directory),
				(error: Error) => error.message.includes(expected),
			)
		},
		30_000,
	)
	it.each([`workspace:../host`, `workspace:other@*`])(
		`rejects unsupported historical syntax %s explicitly`,
		async (range) => {
			const f = setup()
			f.baseline({ host: range })
			await assert.rejects(
				previousManifest(f.config, f.directory),
				(error: Error) =>
					error.message.includes(
						`Unsupported workspace peer range for host: ${range}`,
					),
			)
		},
		30_000,
	)
})
