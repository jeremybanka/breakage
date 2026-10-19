import { existsSync, mkdirSync, symlinkSync } from "node:fs"
import path from "node:path"

import { afterEach, describe, expect, it } from "bun:test"

import { npmCheck, npmTest } from "../src/npm/check.ts"
import { includesRange } from "../src/npm/release.ts"
import type { NpmFixture } from "../tests/public/npm-fixture.ts"
import { assertStagesRemoved, npmFixture } from "../tests/public/npm-fixture.ts"

let fixture: NpmFixture | undefined
afterEach(() => {
	fixture?.clean()
	fixture = undefined
})
function setup(): NpmFixture {
	fixture = npmFixture()
	return fixture
}

describe(`npm release compatibility`, () => {
	it(`runs all matching released formulations in place and shares real peer instances`, async () => {
		const f = setup()
		f.representative(`one`, `1.0.0`)
		f.representative(`one-later`, `1.9.0`)
		f.representative(`two`, `2.0.0`)
		f.write(`fixtures/value.txt`, `copied fixture`)
		f.config.suites.host!.files.push(`fixtures/*`)
		f.write(
			`contracts/check.ts`,
			`${f.read(`contracts/check.ts`)}\nimport { readFileSync } from 'node:fs'; assert.equal(readFileSync('fixtures/value.txt','utf8'), 'copied fixture'); assert.ok(process.cwd().includes('/peer-environments/')); assert.ok(process.cwd().endsWith('/test'));`,
		)
		const result = await npmCheck(f.config, { baseDirectory: f.directory })
		expect(result.exitCode, JSON.stringify(result)).toBe(0)
		expect(result.representatives.map((r) => r.status)).toEqual([
			`passed`,
			`passed`,
			`passed`,
		])
		expect(result.coverage[0]!.representatives).toHaveLength(2)
		expect(result.support.status).toBe(`first-release`)
		assertStagesRemoved(f, result)
	}, 30_000)
	it(`collects compatibility failure and independent passes without certification bypass`, async () => {
		const f = setup()
		f.representative(`one`, `1.0.0`)
		f.representative(`two`, `2.0.0`)
		f.config.releaseIntent = ({ packageName }) =>
			packageName === `integration`
				? { status: `release`, version: `3.0.0` }
				: { status: `none` }
		f.config.certifyBreaking = () => true
		f.write(
			`contracts/check.ts`,
			`${f.read(`contracts/check.ts`)}\nassert.ok(!process.cwd().includes('/one/'), 'released host lacks the new API');`,
		)
		const result = await npmCheck(f.config, { baseDirectory: f.directory })
		expect(result.exitCode).toBe(1)
		expect(result.representatives.map((r) => r.status)).toEqual([
			`compatibility-failure`,
			`passed`,
		])
		assertStagesRemoved(f, result)
	}, 30_000)
	it(`requires every era and does not turn an audit into execution evidence`, async () => {
		const f = setup()
		f.representative(`one`, `1.0.0`)
		f.config.artifact = `does-not-exist.tgz`
		const result = await npmCheck(f.config, {
			baseDirectory: f.directory,
			coverageOnly: true,
		})
		expect(result.exitCode).toBe(2)
		expect(result.errors.join()).toContain(`^2`)
		expect(result.representatives[0]!.status).toBe(`audited`)
		expect(result.representatives[0]!.suites[0]!.status).toBe(`not-run`)
		assertStagesRemoved(f, result)
	}, 30_000)
	it(`requires certified intent for candidate peers and records intended and archive versions`, async () => {
		const f = setup()
		f.representative(`next`, `2.0.0`, true)
		let result = await npmTest(
			f.config,
			{ peer: `host`, range: `3` },
			{ baseDirectory: f.directory },
		)
		expect(result.exitCode).toBe(2)
		expect(result.representatives[0]!.error).toContain(
			`no certified release intent`,
		)
		f.config.releaseIntent = () => ({ status: `release`, version: `3.0.0` })
		result = await npmTest(
			f.config,
			{ peer: `host`, range: `3` },
			{ baseDirectory: f.directory },
		)
		expect(result.exitCode, JSON.stringify(result)).toBe(0)
		expect(result.representatives[0]!.peers.host).toMatchObject({
			version: `3.0.0`,
			archiveVersion: `2.0.0`,
			source: `candidate`,
		})
		expect(result.representatives[0]!.warnings[0]).toContain(
			`outside declared support`,
		)
		expect(JSON.parse(f.read(`local-host/package.json`)).version).toBe(`2.0.0`)
		assertStagesRemoved(f, result)
	}, 30_000)
	it(`treats failed intent inspection as setup failure while other representatives run`, async () => {
		const f = setup()
		f.representative(`next`, `2.0.0`, true)
		f.representative(`released`, `1.0.0`)
		f.config.releaseIntent = () => {
			throw new Error(`release plan unavailable`)
		}
		const result = await npmCheck(f.config, { baseDirectory: f.directory })
		expect(result.exitCode).toBe(2)
		expect(result.representatives.map((r) => r.status)).toEqual([
			`setup-error`,
			`passed`,
		])
		expect(result.representatives[0]!.error).toContain(
			`release plan unavailable`,
		)
		assertStagesRemoved(f, result)
	}, 30_000)
	it(`detects dropped support and accepts explicit repository policy for a breaking release`, async () => {
		const f = setup()
		f.representative(`one`, `1.0.0`)
		f.representative(`two`, `2.0.0`)
		f.baseline({ host: `^1 || ^2 || ^3` })
		let result = await npmCheck(f.config, {
			baseDirectory: f.directory,
			coverageOnly: true,
		})
		expect(result.exitCode).toBe(1)
		expect(result.support.status).toBe(`end-of-support`)
		f.config.releaseIntent = ({ packageName }) =>
			packageName === `integration`
				? { status: `release`, version: `2.0.0` }
				: { status: `none` }
		f.config.certifyBreaking = ({ release, changes }) =>
			release.delta === `major` && changes[0]!.peer === `host`
		result = await npmCheck(f.config, {
			baseDirectory: f.directory,
			coverageOnly: true,
		})
		expect(result.exitCode, JSON.stringify(result)).toBe(0)
		expect(result.support.status).toBe(`certified`)
		expect(result.support.release).toEqual({ version: `2.0.0`, delta: `major` })
	}, 30_000)
	it(`rejects absent or mismatched release baselines instead of silently bootstrapping`, async () => {
		const f = setup()
		f.representative(`one`, `1.0.0`)
		f.config.baseline = { baselineFile: `missing.json` }
		const result = await npmCheck(f.config, {
			baseDirectory: f.directory,
			coverageOnly: true,
		})
		expect(result.exitCode).toBe(2)
		expect(result.support.status).toBe(`setup-error`)
	}, 30_000)
	it(`selects exact representatives and errors for missing requests`, async () => {
		const f = setup()
		f.representative(`one`, `1.0.0`)
		f.representative(`two`, `2.0.0`)
		const result = await npmTest(
			f.config,
			{ representative: `peer-environments/two` },
			{ baseDirectory: f.directory },
		)
		expect(result.exitCode, JSON.stringify(result)).toBe(0)
		expect(result.representatives.map((r) => r.status)).toEqual([
			`skipped`,
			`passed`,
		])
		expect(result.support.status).toBe(`not-checked`)
		const missing = await npmTest(
			f.config,
			{ representative: `absent` },
			{ baseDirectory: f.directory },
		)
		expect(missing.exitCode).toBe(2)
	}, 30_000)
	it(`keeps setup failures distinct from assertions and cleans the owned stage`, async () => {
		const f = setup()
		f.representative(`one`, `1.0.0`)
		f.config.suites.host!.command = `nonexistent-breakage-runner`
		const result = await npmTest(
			f.config,
			{ peer: `host`, range: `1` },
			{ baseDirectory: f.directory },
		)
		expect(result.exitCode).toBe(2)
		expect(result.representatives[0]!.suites[0]!.status).toBe(`setup-error`)
		assertStagesRemoved(f, result)
	}, 30_000)
	it(`rejects preexisting stages and workspace-source peer links without deleting user files`, async () => {
		const f = setup()
		f.representative(`one`, `1.0.0`)
		f.write(`peer-environments/one/test/keep.txt`, `owned by the user`)
		const result = await npmTest(
			f.config,
			{ peer: `host`, range: `1` },
			{ baseDirectory: f.directory },
		)
		expect(result.exitCode).toBe(2)
		expect(f.read(`peer-environments/one/test/keep.txt`)).toBe(
			`owned by the user`,
		)
		f.representative(`linked`, `2.0.0`)
		const deps = path.join(f.directory, `peer-environments/linked/node_modules`)
		mkdirSync(deps)
		symlinkSync(path.join(f.directory, `local-host`), path.join(deps, `host`))
		const linked = await npmTest(
			f.config,
			{ representative: `peer-environments/linked` },
			{ baseDirectory: f.directory },
		)
		expect(linked.exitCode).toBe(2)
		expect(
			linked.representatives.find((r) => r.path.endsWith(`linked`))!.error,
		).toContain(`workspace source`)
		expect(
			existsSync(path.join(f.directory, `peer-environments/linked/test`)),
		).toBe(false)
	}, 30_000)
})

describe(`support sets`, () => {
	it.each([
		[`^1 || ^2`, `>=1 <3`, true],
		[`>=1 <3`, `^1 || ^2`, true],
		[`^2`, `^1 || ^2`, false],
		[`>=1.2.1 <2`, `^1.2.0`, false],
		[`^1.2.0`, `>=1.2.1 <2`, true],
		[`^1`, `*`, false],
		[`>=2.0.0-beta.2 <2.0.0`, `>=2.0.0-beta.1 <2.0.0`, false],
		[`2.0.0-beta.1 || ^2`, `2.0.0-beta.1`, true],
		[`^2`, `2.0.0-beta.1 || ^2`, false],
	])(`compares %s against %s`, (current, previous, expected) => {
		expect(includesRange(current, previous)).toBe(expected)
	})
})
