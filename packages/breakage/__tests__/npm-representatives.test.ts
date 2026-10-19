import { existsSync } from "node:fs"
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

function makeOptional(
	f: NpmFixture,
	directory: string,
	peer: string,
	overridesRequired = false,
): void {
	const manifest = JSON.parse(f.read(`${directory}/package.json`))
	manifest.optionalDependencies = { [peer]: manifest.dependencies[peer] }
	if (overridesRequired) manifest.dependencies[peer] = `99.0.0`
	else delete manifest.dependencies[peer]
	f.write(`${directory}/package.json`, manifest)
	const filename = `${directory}/package-lock.json`
	const lock = JSON.parse(f.read(filename))
	Object.assign(lock.packages[``], {
		dependencies: manifest.dependencies,
		optionalDependencies: manifest.optionalDependencies,
	})
	lock.packages[`node_modules/${peer}`].optional = true
	f.write(filename, lock)
}

describe(`representative development declarations`, () => {
	it.each([`dependencies`, `optionalDependencies`] as const)(
		`rejects conflicting devDependencies and %s before preparation`,
		async (field) => {
			const f = (fixture = npmFixture())
			const directory = `environments/released-2`
			f.update(`${directory}/package.json`, {
				dependencies: {},
				[field]: { host: `1.0.0` },
				devDependencies: { host: `2.0.0` },
			})
			f.config.prepareCommand = `touch prepared`
			const result = await npmTest(
				f.config,
				{ representative: directory },
				{ baseDirectory: f.directory },
			)
			expect(result.exitCode).toBe(2)
			expect(result.representatives[1]!.error).toContain(
				`Conflicting representative declarations for host`,
			)
			for (const detail of [field, `devDependencies`, `1.0.0`, `2.0.0`])
				expect(result.representatives[1]!.error).toContain(detail)
			expect(existsSync(path.join(f.directory, directory, `prepared`))).toBe(
				false,
			)
			assertStagesRemoved(f, result)
		},
		30_000,
	)

	it(`accepts identical development and runtime declarations`, async () => {
		const f = (fixture = npmFixture())
		const directory = `environments/released-1`
		f.update(`${directory}/package.json`, {
			devDependencies: { host: `1.0.0` },
		})
		const filename = `${directory}/package-lock.json`
		const lock = JSON.parse(f.read(filename))
		lock.packages[``].devDependencies = { host: `1.0.0` }
		f.write(filename, lock)
		const result = await npmTest(
			f.config,
			{ representative: directory },
			{ baseDirectory: f.directory },
		)
		expect(result.exitCode, JSON.stringify(result)).toBe(0)
		expect(result.representatives[0]!.suites[0]!.status).toBe(`passed`)
		assertStagesRemoved(f, result)
	}, 30_000)
})

describe(`representative optional dependencies`, () => {
	it.each([
		{ optionalPeer: false, overridesRequired: false },
		{ optionalPeer: true, overridesRequired: false },
		{ optionalPeer: false, overridesRequired: true },
	])(
		`executes installed peers (optional peer: $optionalPeer, overrides required: $overridesRequired)`,
		async ({ optionalPeer, overridesRequired }) => {
			const f = (fixture = npmFixture(undefined, (project) => {
				if (optionalPeer)
					project.update(`package.json`, {
						peerDependenciesMeta: { host: { optional: true } },
					})
			}))
			for (const name of [`released-1`, `released-2`])
				makeOptional(f, `environments/${name}`, `host`, overridesRequired)
			const inputs = [`released-1`, `released-2`].flatMap((name) =>
				[`package.json`, `package-lock.json`].map((file) => {
					const filename = `environments/${name}/${file}`
					return { filename, contents: f.read(filename) }
				}),
			)
			const result = await npmCheck(f.config, { baseDirectory: f.directory })
			expect(result.exitCode, JSON.stringify(result)).toBe(0)
			expect(result.representatives.map((entry) => entry.status)).toEqual([
				`passed`,
				`passed`,
			])
			expect(
				result.representatives.map((entry) => entry.peers.host),
			).toMatchObject([
				{ version: `1.0.0`, source: `installed` },
				{ version: `2.0.0`, source: `installed` },
			])
			for (const representative of result.representatives)
				expect(representative.suites).toMatchObject([
					{ peer: `host`, status: `passed` },
				])
			for (const input of inputs)
				expect(f.read(input.filename)).toBe(input.contents)
			assertStagesRemoved(f, result)
		},
		30_000,
	)

	it.each([false, true])(
		`handles omitted optional dependencies according to peer optionality (%s)`,
		async (optionalPeer) => {
			const f = (fixture = npmFixture(
				new URL(`./fixtures/npm/coupled-peers/`, import.meta.url),
				(project) => {
					if (optionalPeer)
						project.update(`package.json`, {
							peerDependenciesMeta: { "coupled-host": { optional: true } },
						})
				},
			))
			makeOptional(f, `peer-environments/one`, `coupled-host`, true)
			f.config.prepareCommand += ` --omit=optional`
			const result = await npmTest(
				f.config,
				{ representative: `peer-environments/one` },
				{ baseDirectory: f.directory },
			)
			expect(result.exitCode, JSON.stringify(result)).toBe(optionalPeer ? 0 : 2)
			const representative = result.representatives[0]!
			expect(representative.peers[`coupled-host`]).toBeUndefined()
			if (optionalPeer) {
				expect(representative.status).toBe(`passed`)
				expect(representative.suites).toMatchObject([
					{ peer: `coupled-renderer`, status: `passed` },
				])
			} else {
				expect(representative.error).toContain(
					`missing required peer coupled-host`,
				)
				expect(representative.suites).toEqual([])
			}
			assertStagesRemoved(f, result)
		},
		30_000,
	)

	it(`observes an optional dependency needed only by a coordinated candidate`, async () => {
		const f = (fixture = npmFixture(
			new URL(`./fixtures/npm/candidate-peer-ranges/`, import.meta.url),
			(project) => {
				project.update(`package.json`, {
					peerDependencies: { "ranges-host": `^2` },
				})
				project.copy(`src/host-only.ts`, `src/index.ts`)
				delete project.config.suites.renderer
			},
		))
		makeOptional(f, `peer-environments/coordinated`, `renderer`)
		const result = await npmCheck(f.config, { baseDirectory: f.directory })
		expect(result.exitCode, JSON.stringify(result)).toBe(0)
		expect(result.representatives[0]!.peers.renderer).toMatchObject({
			version: `18.0.0`,
			source: `installed`,
		})
		expect(result.representatives[0]!.suites).toMatchObject([
			{ peer: `ranges-host`, status: `passed` },
		])
		expect(result.coverage.map((entry) => entry.peer)).toEqual([`ranges-host`])
		assertStagesRemoved(f, result)
	}, 30_000)

	it.each([`missing manifest`, `broken link`])(
		`rejects an installed optional dependency with a %s`,
		async (damage) => {
			const f = (fixture = npmFixture())
			makeOptional(f, `environments/released-1`, `host`)
			f.config.prepareCommand +=
				damage === `missing manifest`
					? ` && rm node_modules/host/package.json`
					: ` && rm -r node_modules/host && ln -s missing-host node_modules/host`
			const result = await npmTest(
				f.config,
				{ representative: `environments/released-1` },
				{ baseDirectory: f.directory },
			)
			expect(result.exitCode, JSON.stringify(result)).toBe(2)
			expect(result.representatives[0]!.error).toContain(`node_modules/host`)
			expect(result.representatives[0]!.suites).toEqual([])
			assertStagesRemoved(f, result)
		},
		30_000,
	)
})
