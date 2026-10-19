import path from "node:path"

import { afterEach, describe, expect, it } from "bun:test"

import { npmCheck, npmTest } from "../src/npm/check.ts"
import type { NpmFixture } from "../tests/public/npm-fixture.ts"
import { assertStagesRemoved, npmFixture } from "../tests/public/npm-fixture.ts"

let fixture: NpmFixture | undefined
afterEach(() => {
	fixture?.clean()
	fixture = undefined
})

async function setup(
	hostRendererRange: string,
	options: {
		integrationDeclaresRenderer?: boolean
		rendererOptional?: boolean
		rendererVersion?: string
	} = {},
): Promise<NpmFixture> {
	const f = (fixture = npmFixture())
	const integrationDeclaresRenderer =
		options.integrationDeclaresRenderer ?? true
	const rendererVersion = options.rendererVersion ?? `18.0.0`
	const integrationPeers: Record<string, string> = { host: `^2` }
	if (integrationDeclaresRenderer) integrationPeers.renderer = `^18`
	const packages = [
		{
			directory: `renderer-source`,
			name: `renderer`,
			version: rendererVersion,
			peerDependencies: {},
			source: `export const renderer = { render: (text: string): string => '<p>' + text + '</p>' };`,
		},
		{
			directory: `local-host`,
			name: `host`,
			version: `2.0.0`,
			peerDependencies: { renderer: hostRendererRange },
			source: `import { renderer } from 'renderer';
export { renderer };
export const render = (text: string): string => renderer.render(text);`,
		},
		{
			directory: `.`,
			name: `integration`,
			version: `1.1.0`,
			peerDependencies: integrationPeers,
			source: `import { render as renderWithHost } from 'host';
export { renderer } from '${integrationDeclaresRenderer ? `renderer` : `host`}';
export const render = (text: string): string => renderWithHost(text);`,
		},
	]
	const archives: Record<string, string> = {}
	for (const pkg of packages) {
		f.write(`${pkg.directory}/package.json`, {
			name: pkg.name,
			version: pkg.version,
			type: `module`,
			main: `dist/index.js`,
			files: [`dist`],
			peerDependencies: pkg.peerDependencies,
			...(pkg.name === `host` && options.rendererOptional
				? { peerDependenciesMeta: { renderer: { optional: true } } }
				: {}),
		})
		f.write(`${pkg.directory}/index.ts`, pkg.source)
		// Compile authored TypeScript, preserving peer imports for consumer resolution.
		const build = await Bun.build({
			entrypoints: [path.join(f.directory, pkg.directory, `index.ts`)],
			outdir: path.join(f.directory, pkg.directory, `dist`),
			target: `node`,
			format: `esm`,
			external: [`host`, `renderer`],
		})
		if (!build.success)
			throw new Error(`Fixture build failed: ${JSON.stringify(build.logs)}`)
		archives[pkg.name] = f.pack(pkg.directory)
	}
	f.config.artifact = archives.integration!
	f.config.localPeers!.host!.artifact = archives.host!
	f.config.releaseIntent = ({ packageName }) =>
		packageName === `host`
			? { status: `release`, version: `2.0.0` }
			: { status: `none` }
	f.write(
		`contracts/check.ts`,
		`import { strict as assert } from 'node:assert';
import { renderer } from 'renderer';
import { renderer as hostRenderer } from 'host';
import { renderer as integrationRenderer, render } from 'integration';
assert.equal(hostRenderer, renderer);
assert.equal(integrationRenderer, renderer);
assert.equal(render('hello'), '<p>hello</p>');
console.log('Shared renderer identity and rendering assertions passed.');`,
	)
	if (integrationDeclaresRenderer)
		f.config.suites.renderer = f.config.suites.host!
	const representative = {
		name: `environment-coordinated`,
		version: `1.0.0`,
		private: true,
		type: `module`,
		dependencies: { renderer: rendererVersion },
		breakage: { candidates: [`host`] },
	}
	f.write(`peer-environments/coordinated/package.json`, representative)
	// Frozen preparation installs the released renderer from a real local archive.
	// The coordinated host archive is installed afterward into the test stage.
	f.write(`peer-environments/coordinated/package-lock.json`, {
		name: representative.name,
		version: representative.version,
		lockfileVersion: 3,
		requires: true,
		packages: {
			"": {
				name: representative.name,
				version: representative.version,
				dependencies: representative.dependencies,
			},
			"node_modules/renderer": {
				version: rendererVersion,
				resolved: `file:../../${archives.renderer}`,
			},
		},
	})
	f.baseline(integrationPeers)
	return f
}

describe(`coordinated candidate peer declarations`, () => {
	it.each([
		{ hostRendererRange: `^18`, expectedExitCode: 0, expectedStatus: `passed` },
		{
			hostRendererRange: `^19`,
			expectedExitCode: 2,
			expectedStatus: `setup-error`,
		},
	])(
		`host requiring $hostRendererRange with renderer 18 must return $expectedStatus`,
		async ({ hostRendererRange, expectedExitCode, expectedStatus }) => {
			const f = await setup(hostRendererRange)
			const result = await npmCheck(f.config, { baseDirectory: f.directory })
			const representative = result.representatives[0]!
			assertStagesRemoved(f, result)
			expect(result.support.status).toBe(`unchanged`)
			expect(representative.peers.host).toMatchObject({
				version: `2.0.0`,
				source: `candidate`,
			})
			expect(representative.peers.renderer).toMatchObject({
				version: `18.0.0`,
				source: `installed`,
			})
			// A passing rendering assertion cannot override host's declared ^19 peer.
			expect(result.exitCode, JSON.stringify(result, null, 2)).toBe(
				expectedExitCode,
			)
			expect(representative.status).toBe(expectedStatus)
			if (expectedExitCode === 0) {
				expect(representative.warnings).toEqual([])
				expect(representative.suites).toHaveLength(2)
				for (const suite of representative.suites) {
					expect(suite.status).toBe(`passed`)
					expect(suite.output).toContain(
						`Shared renderer identity and rendering assertions passed.`,
					)
				}
			} else {
				for (const detail of [`host`, `renderer`, `^19`, `18.0.0`]) {
					expect(representative.error).toContain(detail)
				}
				for (const suite of representative.suites) {
					expect(suite.status).toBe(`not-run`)
				}
			}
		},
		30_000,
	)

	it.each([false, true])(
		`validates present optional candidate peers (coverage only: %s)`,
		async (coverageOnly) => {
			const f = await setup(`^19`, { rendererOptional: true })
			const result = await npmCheck(f.config, {
				baseDirectory: f.directory,
				coverageOnly,
			})
			expect(result.exitCode, JSON.stringify(result)).toBe(2)
			expect(result.representatives[0]!.error).toContain(
				`requires renderer: ^19`,
			)
			assertStagesRemoved(f, result)
		},
		30_000,
	)

	it.each([
		{ range: `^18`, exitCode: 0 },
		{ range: `^19`, exitCode: 2 },
	])(
		`observes peers needed only by the candidate for range $range`,
		async ({ range, exitCode }) => {
			const f = await setup(range, { integrationDeclaresRenderer: false })
			const result = await npmCheck(f.config, { baseDirectory: f.directory })
			expect(result.exitCode, JSON.stringify(result)).toBe(exitCode)
			expect(result.representatives[0]!.peers.renderer).toMatchObject({
				version: `18.0.0`,
				source: `installed`,
			})
			expect(result.coverage.map((entry) => entry.peer)).toEqual([`host`])
			expect(
				result.representatives[0]!.suites.map((suite) => suite.peer),
			).toEqual([`host`])
			assertStagesRemoved(f, result)
		},
		30_000,
	)

	it.each([false, true])(
		`requires a candidate-only required peer even during focused exploration (%s)`,
		async (focused) => {
			const f = await setup(`^18`, { integrationDeclaresRenderer: false })
			omitRenderer(f)
			const options = { baseDirectory: f.directory }
			const result = focused
				? await npmTest(f.config, { peer: `host`, range: `2` }, options)
				: await npmCheck(f.config, options)
			expect(result.exitCode, JSON.stringify(result)).toBe(2)
			expect(result.representatives[0]!.error).toContain(
				`missing required peer renderer: ^18 of coordinated candidate host@2.0.0`,
			)
			assertStagesRemoved(f, result)
		},
		30_000,
	)

	it(`allows an absent optional candidate peer during the declaration audit`, async () => {
		const f = await setup(`^18`, {
			integrationDeclaresRenderer: false,
			rendererOptional: true,
		})
		omitRenderer(f)
		const result = await npmCheck(f.config, {
			baseDirectory: f.directory,
			coverageOnly: true,
		})
		expect(result.exitCode, JSON.stringify(result)).toBe(0)
		expect(result.representatives[0]!.peers.renderer).toBeUndefined()
		expect(result.representatives[0]!.status).toBe(`audited`)
		assertStagesRemoved(f, result)
	}, 30_000)

	it.each([
		{ range: `^19`, exitCode: 0 },
		{ range: `^18`, exitCode: 2 },
	])(
		`compares another candidate's intended version against $range`,
		async ({ range, exitCode }) => {
			const f = await setup(range)
			const manifest = JSON.parse(f.read(`package.json`))
			f.write(`package.json`, {
				...manifest,
				peerDependencies: { host: `^2`, renderer: `*` },
			})
			f.config.artifact = f.pack(`.`)
			f.config.localPeers!.renderer = {
				directory: `renderer-source`,
				artifact: f.pack(`renderer-source`),
			}
			omitRenderer(f)
			const filename = `peer-environments/coordinated/package.json`
			f.write(filename, {
				...JSON.parse(f.read(filename)),
				breakage: { candidates: [`host`, `renderer`] },
			})
			f.config.releaseIntent = ({ packageName }) => ({
				status: `release`,
				version: packageName === `renderer` ? `19.0.0` : `2.0.0`,
			})
			const result = await npmCheck(f.config, { baseDirectory: f.directory })
			expect(result.exitCode, JSON.stringify(result)).toBe(exitCode)
			expect(result.representatives[0]!.peers.renderer).toMatchObject({
				version: `19.0.0`,
				source: `candidate`,
				...(exitCode === 0 ? { archiveVersion: `18.0.0` } : {}),
			})
			assertStagesRemoved(f, result)
		},
		30_000,
	)

	it.each([
		{ range: `>=18.0.0-beta.1 <19`, exitCode: 0 },
		{ range: `^18`, exitCode: 2 },
	])(
		`uses npm prerelease membership for candidate-only range $range`,
		async ({ range, exitCode }) => {
			const f = await setup(range, {
				integrationDeclaresRenderer: false,
				rendererVersion: `18.0.0-beta.2`,
			})
			const result = await npmCheck(f.config, { baseDirectory: f.directory })
			expect(result.exitCode, JSON.stringify(result)).toBe(exitCode)
			expect(result.representatives[0]!.warnings).toEqual([])
			assertStagesRemoved(f, result)
		},
		30_000,
	)

	it(`warns and executes a passing focused test despite conflicting candidate ranges`, async () => {
		const f = await setup(`^19`)
		const result = await npmTest(
			f.config,
			{ peer: `host`, range: `2` },
			{ baseDirectory: f.directory },
		)
		expect(result.exitCode, JSON.stringify(result)).toBe(0)
		expect(result.representatives[0]!.suites[0]!.status).toBe(`passed`)
		expect(result.representatives[0]!.warnings).toEqual([
			`Coordinated candidate host@2.0.0 requires renderer: ^19, but the representative provides renderer@18.0.0. Running focused exploration outside declared support.`,
		])
		assertStagesRemoved(f, result)
	}, 30_000)
})

function omitRenderer(f: NpmFixture): void {
	const directory = `peer-environments/coordinated`
	const manifest = JSON.parse(f.read(`${directory}/package.json`))
	const lockfile = JSON.parse(f.read(`${directory}/package-lock.json`))
	f.write(`${directory}/package.json`, { ...manifest, dependencies: {} })
	f.write(`${directory}/package-lock.json`, {
		...lockfile,
		packages: { "": { ...lockfile.packages[``], dependencies: {} } },
	})
}
