import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

import { afterEach, expect, it } from "bun:test"
import { breakage, breakagePrelude } from "breakage"

import { fixture, git, shellQuote } from "./fixture.ts"

let project: ReturnType<typeof fixture> | undefined
afterEach(() => project?.cleanup())

it(`accepts an implementation that satisfies released assertions`, async () => {
	project = fixture()
	const result = await breakage(project.options)
	expect(result).toMatchObject({
		gitWasClean: true,
		lastReleaseFound: true,
		lastReleaseTag: `refs/tags/example@1.0.0`,
		testsWereFound: true,
		breakingChangesFound: false,
	})
})

it.each([false, true])(
	`detects a break despite changed current assertions (certified: %s)`,
	async (certified) => {
		project = fixture(true)
		const current = Bun.spawnSync([process.execPath, `public/contract.ts`], {
			cwd: project.repository,
		})
		expect(current.exitCode).toBe(0)
		const result = await breakage({
			...project.options,
			certifyCommand: certified ? `printf 'intentional break'` : `false`,
		})
		expect(result).toMatchObject({
			gitWasClean: true,
			lastReleaseFound: true,
			testsWereFound: true,
			breakingChangesFound: true,
			breakingChangesCertified: certified,
		})
		if (!(`testResult` in result)) throw new Error(`Expected a detected break`)
		expect(result.testResult).toContain(`released consumer behavior`)
		if (certified) expect(result.certificationStdout).toBe(`intentional break`)
	},
)

it.each([false, true])(
	`restores historical test files and preserves other work (broken: %s)`,
	async (changed) => {
		project = fixture(changed)
		const { repository } = project
		project.write(`notes.txt`, `existing stash`)
		git(repository, `stash`, `push`, `-m`, `consumer stash`)
		const stash = git(repository, `stash`, `list`)
		const indexFile = git(repository, `rev-parse`, `--git-path`, `index`).trim()
		const index = readFileSync(path.resolve(repository, indexFile))
		const head = git(repository, `rev-parse`, `HEAD`)
		const currentTests = project.read(`public/contract.ts`)
		const command = path.join(project.directory, `run.ts`)
		await Bun.write(
			command,
			`import { writeFileSync } from "node:fs"\nwriteFileSync("notes.txt", "command edit")\nwriteFileSync("artifacts/result.txt", "command output")\nawait import(${JSON.stringify(path.join(repository, `public/contract.ts`))})\n`,
		)
		project.write(`artifacts/.keep`, ``)
		const result = await breakage({
			...project.options,
			testCommand: `${shellQuote(process.execPath)} ${shellQuote(command)}`,
		})
		expect(result).toMatchObject({ breakingChangesFound: changed })
		expect(project.read(`public/contract.ts`)).toBe(currentTests)
		expect(existsSync(path.join(repository, `public/expected.ts`))).toBe(false)
		expect(project.read(`notes.txt`)).toBe(`command edit`)
		expect(project.read(`artifacts/result.txt`)).toBe(`command output`)
		expect(readFileSync(path.resolve(repository, indexFile))).toEqual(index)
		expect(git(repository, `rev-parse`, `HEAD`)).toBe(head)
		expect(git(repository, `stash`, `list`)).toBe(stash)
	},
)

it(`refuses a dirty checkout without running commands or replacing files`, async () => {
	project = fixture()
	project.write(`notes.txt`, `uncommitted work`)
	const currentTests = project.read(`public/contract.ts`)
	const result = await breakage({
		...project.options,
		testCommand: `touch should-not-run`,
		certifyCommand: `touch should-not-certify`,
	})
	expect(result).toMatchObject({ gitWasClean: false })
	expect(project.read(`notes.txt`)).toBe(`uncommitted work`)
	expect(project.read(`public/contract.ts`)).toBe(currentTests)
	expect(existsSync(path.join(project.repository, `should-not-run`))).toBe(
		false,
	)
	expect(existsSync(path.join(project.repository, `should-not-certify`))).toBe(
		false,
	)
})

it(`pins a deterministic baseline and replays it without an available origin`, async () => {
	project = fixture()
	const baselineFile = `.breakage/baseline.json`
	const options = { ...project.options, out: baselineFile }
	const baseline = await breakagePrelude(options)
	expect(baseline).toMatchObject({
		version: 1,
		ref: `refs/tags/example@1.0.0`,
		commit: git(
			project.repository,
			`rev-parse`,
			`example@1.0.0^{commit}`,
		).trim(),
		packageDirectory: ``,
		tagPattern: project.options.tagPattern,
	})
	const snapshot = project.read(baselineFile)
	await breakagePrelude(options)
	expect(project.read(baselineFile)).toBe(snapshot)
	git(project.repository, `remote`, `remove`, `origin`)
	expect(await breakage({ ...project.options, baselineFile })).toMatchObject({
		breakingChangesFound: false,
	})
	expect(git(project.repository, `status`, `--porcelain`)).toBe(``)
})

it(`reports missing releases and missing public tests as inconclusive`, async () => {
	project = fixture()
	expect(
		await breakage({ ...project.options, tagPattern: `refs/tags/absent@` }),
	).toMatchObject({ gitWasClean: true, lastReleaseFound: false })
	expect(
		await breakage({ ...project.options, testPattern: `missing/**/*.ts` }),
	).toMatchObject({
		gitWasClean: true,
		lastReleaseFound: true,
		testsWereFound: false,
	})
})
