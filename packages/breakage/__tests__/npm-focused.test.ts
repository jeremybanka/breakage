import { existsSync, rmSync } from "node:fs"
import path from "node:path"

import { afterEach, describe, expect, it } from "bun:test"

import { npmTest } from "../src/npm/check.ts"
import type { NpmFixture } from "../tests/public/npm-fixture.ts"
import { assertStagesRemoved, npmFixture } from "../tests/public/npm-fixture.ts"

let fixture: NpmFixture | undefined
afterEach(() => {
	fixture?.clean()
	fixture = undefined
})

describe(`focused peer selection`, () => {
	it.each([`missing lockfile`, `owned stage`])(
		`skips an unselected environment with a %s before preparation`,
		async (problem) => {
			const f = (fixture = npmFixture())
			const other = `environments/released-2`
			if (problem === `missing lockfile`)
				rmSync(path.join(f.directory, other, `package-lock.json`))
			else f.write(`${other}/test/keep.txt`, `another run`)
			const result = await npmTest(
				f.config,
				{ peer: `host`, range: `1` },
				{ baseDirectory: f.directory },
			)
			expect(result.exitCode, JSON.stringify(result)).toBe(0)
			expect(result.representatives.map((entry) => entry.status)).toEqual([
				`passed`,
				`skipped`,
			])
			expect(existsSync(path.join(f.directory, other, `node_modules`))).toBe(
				false,
			)
			if (problem === `owned stage`)
				expect(f.read(`${other}/test/keep.txt`)).toBe(`another run`)
			expect(
				existsSync(path.join(f.directory, `environments/released-1/test`)),
			).toBe(false)
		},
		30_000,
	)

	it.each([
		[`1`, `2`],
		[`1.0.0`, `2.0.0`],
	])(
		`runs requests %s and %s concurrently in one checkout`,
		async (first, second) => {
			const f = (fixture = npmFixture())
			const reports = await Promise.all(
				[first, second].map((range) =>
					npmTest(
						f.config,
						{ peer: `host`, range },
						{ baseDirectory: f.directory },
					),
				),
			)
			expect(
				reports.map((report) => report.exitCode),
				JSON.stringify(reports),
			).toEqual([0, 0])
			expect(
				reports.map((report) =>
					report.representatives.map((entry) => entry.status),
				),
			).toEqual([
				[`passed`, `skipped`],
				[`skipped`, `passed`],
			])
			for (const report of reports) assertStagesRemoved(f, report)
		},
		30_000,
	)

	it(`retains setup failures for a selected environment`, async () => {
		const f = (fixture = npmFixture())
		rmSync(path.join(f.directory, `environments/released-1/package-lock.json`))
		const result = await npmTest(
			f.config,
			{ peer: `host`, range: `1` },
			{ baseDirectory: f.directory },
		)
		expect(result.exitCode).toBe(2)
		expect(result.representatives[0]!.error).toContain(`package-lock.json`)
		expect(result.representatives[1]!.status).toBe(`skipped`)
		assertStagesRemoved(f, result)
	}, 30_000)

	it(`skips an exact preview pin outside a stable request before ownership`, async () => {
		const f = (fixture = npmFixture())
		f.representative(`preview`, `1.1.0-beta.1`)
		f.representative(`stable`, `1.0.0`)
		f.write(`peer-environments/preview/test/keep.txt`, `another run`)
		rmSync(
			path.join(f.directory, `peer-environments/preview/package-lock.json`),
		)
		const result = await npmTest(
			f.config,
			{ peer: `host`, range: `^1` },
			{ baseDirectory: f.directory },
		)
		expect(result.exitCode, JSON.stringify(result)).toBe(0)
		expect(result.representatives.map((entry) => entry.status)).toEqual([
			`skipped`,
			`passed`,
		])
		expect(f.read(`peer-environments/preview/test/keep.txt`)).toBe(
			`another run`,
		)
	}, 30_000)

	it(`rejects overlapping declarations before competing for an owned stage`, async () => {
		const f = (fixture = npmFixture())
		f.update(`environments/released-1/package.json`, {
			dependencies: { host: `^1 || ^2` },
		})
		const filename = `environments/released-1/package-lock.json`
		const lock = JSON.parse(f.read(filename))
		lock.packages[``].dependencies.host = `^1 || ^2`
		f.write(filename, lock)
		f.write(`environments/released-1/test/keep.txt`, `another run`)
		f.config.representatives = `environments/released-1`
		f.config.prepareCommand = `touch prepared`
		const result = await npmTest(
			f.config,
			{ peer: `host`, range: `2` },
			{ baseDirectory: f.directory },
		)
		expect(result.exitCode).toBe(2)
		expect(result.representatives[0]!.error).toContain(
			`must pin dependencies.host to an exact version`,
		)
		expect(f.read(`environments/released-1/test/keep.txt`)).toBe(`another run`)
		expect(
			existsSync(path.join(f.directory, `environments/released-1/prepared`)),
		).toBe(false)
	}, 30_000)

	it(`selects a coordinated candidate using its resolved intended version`, async () => {
		const f = (fixture = npmFixture())
		f.config.representatives = `environments/*`
		let inspections = 0
		f.config.release = {
			version: () => {
				inspections++
				return `3.0.0`
			},
		}
		for (const name of [`released-1`, `released-2`])
			rmSync(path.join(f.directory, `environments/${name}/package-lock.json`))
		const result = await npmTest(
			f.config,
			{ peer: `host`, range: `3` },
			{ baseDirectory: f.directory },
		)
		expect(result.exitCode, JSON.stringify(result)).toBe(0)
		expect(result.representatives.map((entry) => entry.status)).toEqual([
			`passed`,
			`skipped`,
			`skipped`,
		])
		expect(result.representatives[0]!.peers.host).toMatchObject({
			version: `3.0.0`,
			archiveVersion: `2.0.0`,
		})
		expect(inspections).toBe(1)
		assertStagesRemoved(f, result)
	}, 30_000)

	it(`skips a disjoint candidate before requiring its lockfile`, async () => {
		const f = (fixture = npmFixture())
		f.config.representatives = `environments/*`
		f.config.release = { version: () => `3.0.0` }
		rmSync(path.join(f.directory, `environments/candidate/package-lock.json`))
		const result = await npmTest(
			f.config,
			{ peer: `host`, range: `1` },
			{ baseDirectory: f.directory },
		)
		expect(result.exitCode, JSON.stringify(result)).toBe(0)
		expect(result.representatives.map((entry) => entry.status)).toEqual([
			`skipped`,
			`passed`,
			`skipped`,
		])
		expect(
			existsSync(path.join(f.directory, `environments/candidate/node_modules`)),
		).toBe(false)
		assertStagesRemoved(f, result)
	}, 30_000)
})
