import { existsSync } from "node:fs"
import path from "node:path"

import { afterEach, expect, it } from "bun:test"
import { breakage, defineConfig, semverPolicy, versionDelta } from "breakage"
import {
	changesetsRelease,
	readChangesetsReleasePlan,
} from "breakage/changesets"

import { releaseFixture } from "./release-fixture.ts"
import fixtureConfig from "./fixtures/release/packages/library/breakage.config.ts"

let project: ReturnType<typeof releaseFixture> | undefined
afterEach(() => project?.clean())
const configPath = `packages/library/breakage.config.ts`

it.each([
	[`0.53.3`, `0.54.0`, `major`, false],
	[`0.53.3`, `0.54.0`, `minor`, true],
	[`0.53.3`, `0.53.4`, `minor`, false],
	[`0.53.3`, `0.53.4`, `patch`, true],
	[`1.2.3`, `1.3.0`, `patch`, false],
	[`1.2.3`, `2.0.0`, `major`, true],
	[`1.2.3`, `1.2.3`, `major`, false],
	[`0.53.3`, `0.52.0`, `minor`, false],
	[`1.0.0-beta.1`, `1.0.0-beta.2`, `major`, false],
] as const)(
	`compares %s -> %s with beforeV1=%s`,
	(previous, next, beforeV1, breaking) => {
		expect(
			versionDelta(previous, next, semverPolicy({ beforeV1 })).breaking,
		).toBe(breaking)
		expect(versionDelta(previous, next, { beforeV1 }).breaking).toBe(breaking)
	},
)

it(`allows custom policy without accepting older versions`, () => {
	expect(versionDelta(`1.0.0`, `1.1.0`, () => true).breaking).toBe(true)
	expect(versionDelta(`2.0.0`, `1.0.0`, () => true).breaking).toBe(false)
	expect(() => versionDelta(`invalid`, `2.0.0`)).toThrow()
})

it.each([
	{ version: `0.53.3`, bump: `minor`, target: `0.54.0`, code: 0 },
	{ version: `0.53.3`, bump: `patch`, target: `0.53.4`, code: 1 },
	{ version: `1.2.3`, bump: `major`, target: `2.0.0`, code: 0 },
	{ version: `1.2.3`, bump: `minor`, target: `1.3.0`, code: 1 },
] as const)(
	`keeps release intent for $version + $bump after Changesets versioning`,
	async ({ version, bump, target, code }) => {
		project = releaseFixture(version, bump)
		const prelude = project.run(`prelude`, configPath)
		expect(prelude.status, prelude.stderr).toBe(0)
		const resolver = changesetsRelease()
		const check = async (): Promise<void> => {
			const manifest = JSON.parse(
				project!.read(`packages/library/package.json`),
			) as { version: string }
			expect(
				await resolver({
					packageName: `release-library`,
					packageDirectory: project!.library,
					currentVersion: manifest.version,
				}),
			).toBe(target)
			const result = project!.run(
				configPath,
				`--baseline-file=.breakage/baseline.json`,
			)
			expect(result.status, result.stdout + result.stderr).toBe(code)
			expect(result.stdout).toContain(`${version} → ${target}`)
			expect(project!.git(`status`, `--porcelain`)).toBe(``)
		}
		expect(
			(await readChangesetsReleasePlan(project.library)).get(`release-library`),
		).toBe(target)
		await check()
		project.version()
		expect(
			existsSync(path.join(project.directory, `.changeset/release.md`)),
		).toBe(false)
		project.commit()
		expect((await readChangesetsReleasePlan(project.library)).size).toBe(0)
		await check()
	},
	20_000,
)

it(`uses the manifest version and pinned commit without needing origin`, async () => {
	project = releaseFixture()
	expect(project.run(`prelude`, configPath).status).toBe(0)
	project.version()
	project.commit()
	project.git(`tag`, `release-library@0.54.0`)
	project.git(`remote`, `remove`, `origin`)
	const config = { ...fixtureConfig, baseDirname: project.library }
	const result = await breakage({
		...config,
		testPattern: config.testPattern!,
		baselineFile: `.breakage/baseline.json`,
		release: { policy: semverPolicy({ beforeV1: `minor` }) },
	})
	expect(result).toMatchObject({
		release: { previousVersion: `0.53.3`, version: `0.54.0`, breaking: true },
	})
})

it(`does not permit unchanged releases, missing evidence, or task setup errors`, async () => {
	project = releaseFixture()
	const config = { ...fixtureConfig, baseDirname: project.library }
	const options = { ...config, testPattern: config.testPattern! }
	expect(await breakage({ ...options, release: {} })).toMatchObject({
		release: { breaking: false },
	})
	expect(
		await breakage({ ...options, release: { version: () => undefined } }),
	).not.toHaveProperty(`release`)
	for (const test of [
		() => {
			throw new Error(`setup failed`)
		},
		() => ({ code: 2, output: `setup failed` }),
	]) {
		expect(await breakage({ ...options, test })).toMatchObject({
			setupError: `setup failed`,
		})
		expect(project.git(`status`, `--porcelain`)).toBe(``)
	}
	expect(
		await breakage({ ...options, release: { version: `invalid` } }).catch(
			(error: unknown) => error,
		),
	).toBeInstanceOf(Error)
	expect(project.git(`status`, `--porcelain`)).toBe(``)
})

it(`passes pinned context to inline tasks without changing process cwd`, async () => {
	project = releaseFixture()
	const config = { ...fixtureConfig, baseDirname: project.library }
	const cwd = process.cwd()
	const result = await breakage({
		...config,
		testPattern: config.testPattern!,
		test: async (context) => {
			expect(context.cwd).toBe(project!.library)
			expect(context.baseline.ref).toBe(`refs/tags/release-library@0.53.3`)
			expect(context.baseline.commit).toMatch(/^[a-f0-9]{40}$/)
			expect(process.cwd()).toBe(cwd)
			return await context.run(`node public/contract.ts`)
		},
	})
	expect(result).toMatchObject({ release: { breaking: true } })
})

it(`shares a release object with npm while preserving explicit overrides`, () => {
	const release = { policy: semverPolicy({ beforeV1: `minor` }) }
	const npm = {
		artifact: `package.tgz`,
		representatives: `peers/*`,
		lockfile: `package-lock.json`,
		prepareCommand: `npm ci`,
		suites: {
			host: {
				files: [`test.ts`],
				command: ({ run }: import("breakage").TaskContext) =>
					run(`node test.ts`),
			},
		},
		baseline: { firstRelease: true as const },
	}
	expect(defineConfig({ release, npm }).npm!.release).toBe(release)
	const override = { version: `3.0.0` }
	expect(
		defineConfig({ release, npm: { ...npm, release: override } }).npm!.release,
	).toBe(override)
})

it(`discovers TypeScript before JSON, resolves config paths, and applies CLI overrides`, () => {
	project = releaseFixture(`0.53.3`, `patch`)
	project.write(`breakage.config.ts`, project.read(`project.config.ts`))
	project.write(`breakage.config.json`, `{ invalid`)
	project.commit()
	const prelude = project.run(`prelude`)
	expect(prelude.status, prelude.stderr).toBe(0)
	expect(existsSync(path.join(project.library, `.breakage/custom.json`))).toBe(
		true,
	)
	const check = project.run(`--baseline-file=.breakage/custom.json`)
	expect(check.status, check.stdout + check.stderr).toBe(1)
	const override = project.run(
		`--baseline-file=.breakage/custom.json`,
		`--test-command=true`,
	)
	expect(override.status, override.stdout + override.stderr).toBe(0)
	expect(override.stdout).toContain(`No breaking changes`)
	const invalid = project.run(`breakage.config.json`)
	expect(invalid.status).toBe(2)
	expect(invalid.stderr).toContain(`setup error`)
	expect(project.git(`status`, `--porcelain`)).toBe(``)
}, 20_000)

it(`propagates Changesets configuration failures instead of guessing release intent`, () => {
	project = releaseFixture()
	project.write(`.changeset/config.json`, `{ invalid`)
	project.commit()
	const result = project.run(configPath)
	expect(result.status).toBe(2)
	expect(result.stderr).toContain(`setup error`)
	expect(project.git(`status`, `--porcelain`)).toBe(``)
})

it(`supports JSON release policy and shell tasks before and after versioning`, () => {
	project = releaseFixture()
	const filename = `packages/library/breakage.config.json`
	const config = {
		tagPattern: `refs/tags/release-library@`,
		testPattern: fixtureConfig.testPattern,
		test: `node public/contract.ts`,
		release: { version: `0.54.0`, policy: { beforeV1: `minor` } },
	}
	project.write(filename, config)
	project.commit()
	const before = project.run(filename)
	expect(before.status, before.stdout + before.stderr).toBe(0)
	expect(before.stdout).toContain(`0.53.3 → 0.54.0`)
	project.version()
	project.write(filename, {
		...config,
		release: { policy: { beforeV1: `minor` } },
	})
	project.commit()
	const after = project.run(filename)
	expect(after.status, after.stdout + after.stderr).toBe(0)
	expect(after.stdout).toContain(`0.53.3 → 0.54.0`)
	expect(project.git(`status`, `--porcelain`)).toBe(``)
}, 20_000)

it.each([0, 1, 2])(
	`shares shell and function task semantics for exit %s`,
	async (code) => {
		project = releaseFixture()
		const options: import("breakage").BreakageOptions = {
			...fixtureConfig,
			baseDirname: project.library,
			testPattern: fixtureConfig.testPattern!,
		}
		delete options.test
		for (const task of [
			{ test: `exit ${code}` },
			{ test: () => ({ code, output: `` }) },
			{ testCommand: `exit ${code}` },
		]) {
			const outcome = await breakage({ ...options, ...task })
			if (code === 2) {
				expect(outcome).toHaveProperty(`setupError`)
				expect(outcome).not.toHaveProperty(`breakingChangesFound`)
			} else {
				expect(outcome).toMatchObject({
					breakingChangesFound: code === 1,
					release: { breaking: true },
				})
			}
			for (const key of [
				`breakingChangesCertified`,
				`certificationStdout`,
				`certificationStderr`,
			])
				expect(outcome).not.toHaveProperty(key)
			expect(project.git(`status`, `--porcelain`)).toBe(``)
		}
	},
)

it.each([`certifyCommand`, `releaseIntent`, `certifyBreaking`])(
	`rejects removed %s in JSON and programmatic options`,
	async (key) => {
		project = releaseFixture()
		const config = {
			...fixtureConfig,
			baseDirname: project.library,
			testPattern: fixtureConfig.testPattern!,
			[key]: `true`,
		}
		expect(() => defineConfig(config)).toThrow(`${key} was removed`)
		expect(
			await breakage(config).catch((error: unknown) => error),
		).toMatchObject({
			message: `${key} was removed. Use release.version and release.policy instead.`,
		})
		for (const oldConfig of [{ [key]: `true` }, { npm: { [key]: `true` } }]) {
			project.write(`breakage.config.json`, oldConfig)
			project.commit()
			const result = project.run(`breakage.config.json`)
			expect(result.status).toBe(2)
			expect(result.stderr).toContain(`${key} was removed`)
		}
	},
)

it.each([`--certifyCommand=true`, `--certify-command=true`, `-c=true`])(
	`rejects removed flag %s`,
	(flag) => {
		project = releaseFixture()
		const result = project.run(configPath, flag)
		expect(result.status).toBe(2)
		expect(result.stderr).toContain(`certifyCommand was removed`)
	},
)

it.each([
	{ policy: null },
	{ policy: [] },
	{ policy: { beforeV1: `invalid` } },
	{ policy: { beforeOne: `minor` } },
])(`rejects invalid JSON policies: %j`, ({ policy }) => {
	expect(() =>
		defineConfig({ release: { policy } } as unknown as Parameters<
			typeof defineConfig
		>[0]),
	).toThrow()
})

it(`accepts JSON release flags and reports malformed JSON as a setup error`, () => {
	project = releaseFixture()
	const result = project.run(
		configPath,
		`--test=exit 1`,
		`--release={"version":"0.54.0","policy":{"beforeV1":"minor"}}`,
	)
	expect(result.status, result.stdout + result.stderr).toBe(0)
	expect(result.stdout).toContain(`0.53.3 → 0.54.0`)
	const invalid = project.run(configPath, `--release={invalid`)
	expect(invalid.status).toBe(2)
	expect(invalid.stderr).toContain(`setup error`)
})
