import { execFileSync, spawnSync } from "node:child_process"
import {
	cpSync,
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, expect, it } from "bun:test"
import {
	npmPlan,
	npmExecute,
	npmVerify,
	npmMatrix,
	verifyNpmReceipts,
	type NpmPlan,
	type NpmReceipt,
} from "breakage"
import { git, npmFixture, type NpmFixture } from "./npm-fixture.ts"

let project: NpmFixture | undefined
const copies: string[] = []
afterEach(() => {
	project?.clean()
	project = undefined
	for (const copy of copies.splice(0))
		rmSync(copy, { recursive: true, force: true })
})
function fixture(broken = false): NpmFixture {
	const f = (project = npmFixture())
	f.representative(`oldest`, `1.0.0`)
	f.representative(`current`, `2.0.0`)
	if (broken) {
		f.copy(`src/broken.ts`, `src/index.ts`)
		f.build(`.`)
	}
	f.write(`fixture-config.json`, { npm: f.config })
	git(f.directory, `add`, `.`)
	git(f.directory, `commit`, `-m`, `Complete miniature peer matrix`)
	return f
}
function cli(directory: string, ...args: string[]) {
	return cliWithEnvironment(directory, {}, ...args)
}
function cliWithEnvironment(
	directory: string,
	environment: Record<string, string>,
	...args: string[]
) {
	const entrypoint = process.env.BREAKAGE_CLI_ENTRYPOINT
	if (!entrypoint) throw new Error(`BREAKAGE_CLI_ENTRYPOINT is required`)
	const result = spawnSync(`node`, [path.resolve(entrypoint), `npm`, ...args], {
		cwd: directory,
		encoding: `utf8`,
		timeout: 40_000,
		env: { ...process.env, ...environment },
	})
	expect(result.error).toBeUndefined()
	return result
}
const planFile = `.breakage/npm-plan/plan.json`

it(`prepares each archive once and verifies executions relocated to another checkout`, async () => {
	const f = fixture()
	let preparations = 0
	const plan = await npmPlan(
		{
			configs: [`dynamic-matrix.config.ts`, `dynamic-matrix.config.ts`],
			prepare: ({ rootDirectory, archives }) => {
				expect(rootDirectory).toBe(f.directory)
				preparations++
				expect(archives.map((a) => a.packageName).sort()).toEqual([
					`host`,
					`integration`,
				])
				for (const archive of archives)
					expect(f.pack(archive.directory)).toBe(archive.artifact)
			},
			label: ({ peers }) => `host ${peers.host!.version}`,
		},
		{ rootDirectory: f.directory },
	)
	expect(preparations).toBe(1)
	expect(npmMatrix(plan).include.map((e) => e.label)).toEqual([
		`host 2.0.0`,
		`host 1.0.0`,
	])
	expect(JSON.stringify(plan)).not.toContain(f.directory)
	expect(JSON.parse(f.read(planFile))).toEqual(plan)
	const runner = mkdtempSync(path.join(tmpdir(), `breakage-matrix-runner-`))
	copies.push(runner)
	cpSync(f.directory, runner, { recursive: true })
	// Candidate execution must use the transported archive bundle, not these files.
	rmSync(path.join(runner, f.config.artifact))
	const receipts: NpmReceipt[] = []
	for (const env of plan.environments) {
		const receipt = await npmExecute(plan, env.id, { rootDirectory: runner })
		expect(receipt.exitCode, JSON.stringify(receipt)).toBe(0)
		receipts.push(receipt)
	}
	expect(preparations).toBe(1)
	expect(
		await npmVerify(plan, receipts.reverse(), { rootDirectory: f.directory }),
	).toEqual({ exitCode: 0, errors: [], environments: 2 })
	for (const receipt of receipts)
		f.write(`.breakage/receipts/${receipt.id}.json`, receipt)
	const verified = cli(
		f.directory,
		`verify`,
		`--plan`,
		planFile,
		`--receipts`,
		`.breakage/receipts/*.json`,
	)
	expect(verified.status, verified.stdout + verified.stderr).toBe(0)
	expect(verified.stdout).toContain(`all 2 planned environments`)
	const changedConfig = cliWithEnvironment(
		runner,
		{ BREAKAGE_MATRIX_COMMAND: `node --version` },
		`execute`,
		plan.environments[0]!.id,
		`--plan`,
		planFile,
		`--receipt`,
		`.breakage/config-failure.json`,
	)
	expect(changedConfig.status).toBe(2)
	expect(changedConfig.stderr).toContain(
		`Configuration changed for integration`,
	)
	expect(
		(await npmVerify(plan, receipts.slice(1), { rootDirectory: runner }))
			.exitCode,
	).toBe(2)
	const unknown = await npmExecute(plan, `unknown`, { rootDirectory: runner })
	expect(unknown.error).toContain(`Unknown planned environment`)

	const archive = path.join(
		runner,
		`.breakage/npm-plan`,
		plan.archives[0]!.file,
	)
	const original = readFileSync(archive)
	writeFileSync(archive, `changed archive`)
	expect(
		(
			await npmExecute(plan, plan.environments[0]!.id, {
				rootDirectory: runner,
			})
		).error,
	).toContain(`Candidate archive changed`)
	expect(
		(await npmVerify(plan, receipts, { rootDirectory: runner })).errors.join(),
	).toContain(`Candidate archive changed`)
	writeFileSync(archive, original)
	writeFileSync(path.join(runner, `src/index.ts`), `changed tracked source`)
	expect(
		(await npmVerify(plan, receipts, { rootDirectory: runner })).errors.join(),
	).toContain(`clean checkout`)
	git(runner, `add`, `.`)
	git(runner, `commit`, `-m`, `Different source commit`)
	expect(
		(await npmVerify(plan, receipts, { rootDirectory: runner })).errors.join(),
	).toContain(`different source commit`)

	// Failed preparation invalidates the previous plan instead of leaving stale success.
	const failedPreparation = await npmPlan(
		{
			configs: `data.config.ts`,
			prepare: () => {
				throw new Error(`packing failed`)
			},
		},
		{ rootDirectory: f.directory },
	).catch((error: unknown) => error)
	expect(failedPreparation).toBeInstanceOf(Error)
	expect((failedPreparation as Error).message).toContain(`packing failed`)
	expect(existsSync(path.join(f.directory, planFile))).toBe(false)
}, 60_000)

it(`exposes the full plan/execute/verify CLI with clean JSON output and durable failure receipts`, () => {
	const f = fixture(true)
	const planned = cli(
		path.dirname(f.directory),
		`plan`,
		`--root`,
		f.directory,
		`--config`,
		`matrix.config.ts`,
	)
	expect(planned.status, planned.stdout + planned.stderr).toBe(0)
	const matrix = JSON.parse(planned.stdout) as ReturnType<typeof npmMatrix>
	expect(matrix.include).toHaveLength(2)
	expect(f.read(`.breakage/prepare-runs`)).toBe(`prepared\n`)
	const plan = JSON.parse(f.read(planFile)) as NpmPlan
	for (const env of matrix.include) {
		const receiptFile = `.breakage/receipts/${env.id}.json`
		const executed = cli(
			f.directory,
			`execute`,
			env.id,
			`--plan`,
			planFile,
			`--receipt`,
			receiptFile,
		)
		expect(executed.status, executed.stdout + executed.stderr).toBe(1)
		const receipt = JSON.parse(f.read(receiptFile)) as NpmReceipt
		expect(receipt.planId).toBe(plan.id)
		expect(receipt.exitCode).toBe(1)
		expect(verifyNpmReceipts(plan, [receipt]).exitCode).toBe(2)
	}
	const verified = cli(
		f.directory,
		`verify`,
		`--plan`,
		planFile,
		`--receipts`,
		`.breakage/receipts/*.json`,
	)
	expect(verified.status).toBe(2)
	expect(verified.stderr).toContain(`execution failed`)
	const absent = cli(
		f.directory,
		`verify`,
		`--plan`,
		planFile,
		`--receipts`,
		`.breakage/no-receipts/*.json`,
	)
	expect(absent.status).toBe(2)
	expect(absent.stderr).toContain(`Missing`)
	f.write(`.breakage/fail-preparation`, ``)
	const failed = cli(f.directory, `plan`, `--config`, `matrix.config.ts`)
	expect(failed.status).toBe(2)
	expect(failed.stderr).toContain(`Requested preparation failure`)
	expect(existsSync(path.join(f.directory, planFile))).toBe(false)
	expect(f.read(`.breakage/prepare-runs`)).toBe(`prepared\nprepared\n`)
}, 60_000)

it(`binds ignored contracts and rejects incomplete coverage before preparation`, async () => {
	const f = fixture()
	f.write(`.gitignore`, `${f.read(`.gitignore`)}contracts/generated.ts\n`)
	f.write(`contracts/generated.ts`, f.read(`contracts/check.ts`))
	git(f.directory, `add`, `.`)
	git(f.directory, `commit`, `-m`, `Allow generated contract input`)
	const location = { rootDirectory: f.directory }
	const plan = await npmPlan(
		{ configs: `data.config.ts`, prepare: () => {} },
		location,
	)
	f.write(`contracts/generated.ts`, `changed ignored contract`)
	expect(git(f.directory, `status`, `--porcelain`)).toBe(``)
	expect(
		(await npmExecute(plan, plan.environments[0]!.id, location)).error,
	).toContain(`inputs changed`)
	f.write(`contracts/generated.ts`, f.read(`contracts/check.ts`))
	f.update(`package.json`, { peerDependencies: { host: `^1 || ^2 || ^3` } })
	git(f.directory, `add`, `.`)
	git(f.directory, `commit`, `-m`, `Declare an uncovered peer era`)
	let prepared = false
	const failedCoverage = await npmPlan(
		{
			configs: `data.config.ts`,
			prepare: () => {
				prepared = true
			},
		},
		location,
	).catch((error: unknown) => error)
	expect(failedCoverage).toBeInstanceOf(Error)
	expect((failedCoverage as Error).message).toContain(
		`No representative covers host: ^3`,
	)
	expect(prepared).toBe(false)
	expect(existsSync(path.join(f.directory, planFile))).toBe(false)
}, 45_000)

it(`keeps Changesets release evidence and candidate identities before and after versioning`, async () => {
	const f = fixture()
	const require = createRequire(import.meta.url)
	const packageRoot = path.dirname(require.resolve(`breakage/package.json`))
	// Public contracts run against source in a fresh checkout, without dist/.
	f.write(`tsconfig.json`, {
		compilerOptions: {
			paths: {
				breakage: [path.join(packageRoot, `src/breakage.ts`)],
				"breakage/changesets": [path.join(packageRoot, `src/changesets.ts`)],
			},
		},
	})
	f.update(`package.json`, { private: false, version: `0.1.0` })
	git(f.directory, `add`, `.`)
	git(f.directory, `commit`, `-m`, `Released support for both host eras`)
	const baseline = git(f.directory, `rev-parse`, `HEAD`).trim()
	git(f.directory, `tag`, `integration@0.1.0`)
	f.write(`.breakage/baseline.json`, {
		version: 1,
		tagPattern: null,
		packageDirectory: ``,
		ref: `refs/tags/integration@0.1.0`,
		commit: baseline,
	})
	f.update(`package.json`, {
		version: `0.1.1`,
		peerDependencies: { host: `^2` },
	})
	rmSync(path.join(f.directory, `peer-environments/oldest`), {
		recursive: true,
	})
	f.representative(`candidate`, `2.0.0`, true)
	f.config.baseline = { baselineFile: `.breakage/baseline.json` }
	f.write(`fixture-config.json`, { npm: f.config })
	f.copy(
		new URL(`./fixtures/release/.changeset/config.json`, import.meta.url),
		`.changeset/config.json`,
	)
	f.copy(`matrix-release.md`, `.changeset/release.md`)
	git(f.directory, `add`, `.`)
	git(f.directory, `commit`, `-m`, `Intentional breaking minor release`)
	const location = { rootDirectory: f.directory }
	const config = {
		configs: `changesets-matrix.config.ts`,
		prepare: `node prepare-matrix.ts`,
	}
	const before = await npmPlan(config, location)
	expect(before.packages[0]!.audit.support).toMatchObject({
		status: `breaking-release`,
		release: {
			previousVersion: `0.1.0`,
			version: `0.2.0`,
			delta: `minor`,
			breaking: true,
		},
	})
	const receipts: NpmReceipt[] = []
	for (const env of before.environments)
		receipts.push(await npmExecute(before, env.id, location))
	expect(await npmVerify(before, receipts, location)).toMatchObject({
		exitCode: 0,
		errors: [],
	})
	execFileSync(
		`node`,
		[
			path.join(
				path.dirname(require.resolve(`@changesets/cli/package.json`)),
				`bin.js`,
			),
			`version`,
		],
		{ cwd: f.directory, stdio: `pipe` },
	)
	expect(JSON.parse(f.read(`package.json`)).version).toBe(`0.2.0`)
	git(f.directory, `add`, `.`)
	git(f.directory, `commit`, `-m`, `Version Packages`)
	const after = await npmPlan(config, location)
	expect(after.packages[0]!.audit.support.release).toEqual(
		before.packages[0]!.audit.support.release,
	)
	expect(verifyNpmReceipts(after, receipts).exitCode).toBe(2)
	const versioned: NpmReceipt[] = []
	for (const env of after.environments)
		versioned.push(await npmExecute(after, env.id, location))
	expect(await npmVerify(after, versioned, location)).toMatchObject({
		exitCode: 0,
		errors: [],
	})
}, 60_000)
