import { afterEach, describe, expect, it } from "bun:test"

import { npmCheck, npmTest } from "../src/npm/check.ts"
import type { NpmFixture } from "../tests/public/npm-fixture.ts"
import { assertStagesRemoved, npmFixture } from "../tests/public/npm-fixture.ts"

let fixture: NpmFixture | undefined
afterEach(() => {
	fixture?.clean()
	fixture = undefined
})

function setup(
	hostRendererRange: string,
	options: {
		integrationDeclaresRenderer?: boolean
		rendererOptional?: boolean
		rendererVersion?: string
	} = {},
): NpmFixture {
	const f = (fixture = npmFixture(
		new URL(`./fixtures/npm/candidate-peer-ranges/`, import.meta.url),
		(project) => {
			project.update(`local-host/package.json`, {
				peerDependencies: { renderer: hostRendererRange },
				...(options.rendererOptional
					? { peerDependenciesMeta: { renderer: { optional: true } } }
					: {}),
			})
			if (options.integrationDeclaresRenderer === false) {
				project.update(`package.json`, {
					peerDependencies: { "ranges-host": `^2` },
				})
				project.copy(`src/host-only.ts`, `src/index.ts`)
				delete project.config.suites.renderer
			}
			if (options.rendererVersion) {
				const version = options.rendererVersion
				project.update(`renderer-source/package.json`, { version })
				project.update(`peer-environments/coordinated/package.json`, {
					dependencies: { renderer: version },
				})
				const filename = `peer-environments/coordinated/package-lock.json`
				const lock = JSON.parse(project.read(filename))
				lock.packages[``].dependencies.renderer = version
				Object.assign(lock.packages[`node_modules/renderer`], {
					version,
					resolved: `file:../../artifacts/renderer-${version}.tgz`,
				})
				project.write(filename, lock)
			}
		},
	))
	f.baseline(JSON.parse(f.read(`package.json`)).peerDependencies)
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
			const f = setup(hostRendererRange)
			const result = await npmCheck(f.config, { baseDirectory: f.directory })
			const representative = result.representatives[0]!
			assertStagesRemoved(f, result)
			expect(result.support.status).toBe(`unchanged`)
			expect(representative.peers[`ranges-host`]).toMatchObject({
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
				for (const detail of [`ranges-host`, `renderer`, `^19`, `18.0.0`]) {
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
			const f = setup(`^19`, { rendererOptional: true })
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
			const f = setup(range, { integrationDeclaresRenderer: false })
			const result = await npmCheck(f.config, { baseDirectory: f.directory })
			expect(result.exitCode, JSON.stringify(result)).toBe(exitCode)
			expect(result.representatives[0]!.peers.renderer).toMatchObject({
				version: `18.0.0`,
				source: `installed`,
			})
			expect(result.coverage.map((entry) => entry.peer)).toEqual([
				`ranges-host`,
			])
			expect(
				result.representatives[0]!.suites.map((suite) => suite.peer),
			).toEqual([`ranges-host`])
			assertStagesRemoved(f, result)
		},
		30_000,
	)

	it.each([false, true])(
		`requires a candidate-only required peer even during focused exploration (%s)`,
		async (focused) => {
			const f = setup(`^18`, { integrationDeclaresRenderer: false })
			omitRenderer(f)
			const options = { baseDirectory: f.directory }
			const result = focused
				? await npmTest(f.config, { peer: `ranges-host`, range: `2` }, options)
				: await npmCheck(f.config, options)
			expect(result.exitCode, JSON.stringify(result)).toBe(2)
			expect(result.representatives[0]!.error).toContain(
				`missing required peer renderer: ^18 of coordinated candidate ranges-host@2.0.0`,
			)
			assertStagesRemoved(f, result)
		},
		30_000,
	)

	it(`allows an absent optional candidate peer during the declaration audit`, async () => {
		const f = setup(`^18`, {
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
			const f = setup(range)
			const manifest = JSON.parse(f.read(`package.json`))
			f.write(`package.json`, {
				...manifest,
				peerDependencies: { "ranges-host": `^2`, renderer: `*` },
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
				breakage: { candidates: [`ranges-host`, `renderer`] },
			})
			f.config.release = {
				version: ({ packageName }) =>
					packageName === `renderer` ? `19.0.0` : `2.0.0`,
			}
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
			const f = setup(range, {
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
		const f = setup(`^19`)
		const result = await npmTest(
			f.config,
			{ peer: `ranges-host`, range: `2` },
			{ baseDirectory: f.directory },
		)
		expect(result.exitCode, JSON.stringify(result)).toBe(0)
		expect(result.representatives[0]!.suites[0]!.status).toBe(`passed`)
		expect(result.representatives[0]!.warnings).toEqual([
			`Coordinated candidate ranges-host@2.0.0 requires renderer: ^19, but the representative provides renderer@18.0.0. Running focused exploration outside declared support.`,
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
