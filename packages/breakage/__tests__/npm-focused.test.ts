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

	it(`runs disjoint peer ranges concurrently in one checkout`, async () => {
		const f = (fixture = npmFixture())
		const reports = await Promise.all(
			[`1`, `2`].map((range) =>
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
	}, 30_000)

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

	it(`checks installed versions when a broad declaration overlaps the request`, async () => {
		const f = (fixture = npmFixture())
		f.update(`environments/released-1/package.json`, {
			dependencies: { host: `^1 || ^2` },
		})
		const filename = `environments/released-1/package-lock.json`
		const lock = JSON.parse(f.read(filename))
		lock.packages[``].dependencies.host = `^1 || ^2`
		f.write(filename, lock)
		const result = await npmTest(
			f.config,
			{ peer: `host`, range: `2` },
			{ baseDirectory: f.directory },
		)
		expect(result.exitCode, JSON.stringify(result)).toBe(0)
		expect(result.representatives.map((entry) => entry.status)).toEqual([
			`skipped`,
			`passed`,
		])
		expect(result.representatives[0]!.peers.host!.version).toBe(`1.0.0`)
		assertStagesRemoved(f, result)
	}, 30_000)

	it(`selects a coordinated candidate using its certified intended version`, async () => {
		const f = (fixture = npmFixture())
		f.config.representatives = `environments/*`
		let inspections = 0
		f.config.releaseIntent = () => {
			inspections++
			return { status: `release`, version: `3.0.0` }
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
		f.config.releaseIntent = () => ({ status: `release`, version: `3.0.0` })
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
