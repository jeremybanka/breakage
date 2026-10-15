import { mkdtempSync, rmSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { simpleGit } from "simple-git"

import type { BreakageOutcome } from "../src/breakage.ts"
import { breakage } from "../src/breakage.ts"
import { bunCopyFile } from "./utilities.ts"

let tempDir: string
let localRepoDirname: string
let remoteRepoDirname: string
const testDirname = import.meta.dir

beforeEach(async () => {
	tempDir = mkdtempSync(path.join(tmpdir(), `breakage-`))
	localRepoDirname = `${tempDir}/my-library`
	remoteRepoDirname = `${tempDir}/my-library.git`
	await mkdir(remoteRepoDirname)

	const remoteGit = simpleGit(remoteRepoDirname)
	await remoteGit
		.init([`--bare`, `--initial-branch=main`])
		.cwd(remoteRepoDirname)

	await bunCopyFile(
		`${testDirname}/fixtures/bun/src.ts`,
		`${localRepoDirname}/src.ts`,
	)
	await bunCopyFile(
		`${testDirname}/fixtures/bun/public-method__public.fixture.ts`,
		`${localRepoDirname}/public-method__public.test.ts`,
	)
	await bunCopyFile(
		`${testDirname}/fixtures/bun/private-method.fixture.ts`,
		`${localRepoDirname}/private-method.test.ts`,
	)
	await bunCopyFile(
		`${testDirname}/fixtures/bun/certify-major-version.ts`,
		`${localRepoDirname}/certify-major-version.ts`,
	)
	await bunCopyFile(
		`${testDirname}/fixtures/bun/.changesets/decent-files-exemplify.md`,
		`${localRepoDirname}/.changesets/decent-files-exemplify.md`,
	)
	expect(
		await Bun.file(`${localRepoDirname}/public-method__public.test.ts`).text(),
	).toEqual(
		await Bun.file(
			`${testDirname}/fixtures/bun/public-method__public.fixture.ts`,
		).text(),
	)
})
afterEach(() => {
	rmSync(tempDir, { recursive: true, force: true })
})

describe(`breakage`, () => {
	it(`determines whether breaking changes were made`, async () => {
		const git = simpleGit(localRepoDirname)
		await git
			.init()
			.addConfig(`user.name`, `Breakage Test`)
			.addConfig(`user.email`, `breakage@example.invalid`)
			.add(`.`)
			.commit(`Initial commit`)
			.addAnnotatedTag(`my-library@1.0.0`, `initial release`)
		await git.addRemote(`origin`, remoteRepoDirname)
		await git.push([`--tags`, `origin`])

		const srcContent = await Bun.file(`${localRepoDirname}/src.ts`).text()
		const modifiedSrcContent = srcContent.replace(
			`"publicMethodOutput"`,
			`"modifiedPublicMethodOutput"`,
		)
		await Bun.write(`${localRepoDirname}/src.ts`, modifiedSrcContent)
		const testContent = await Bun.file(
			`${localRepoDirname}/public-method__public.test.ts`,
		).text()
		const modifiedTestContent = testContent.replace(
			`"publicMethodOutput"`,
			`"modifiedPublicMethodOutput"`,
		)
		await Bun.write(
			`${localRepoDirname}/public-method__public.test.ts`,
			modifiedTestContent,
		)
		await git.add(`.`)
		await git.commit(`breaking change`)
		let caught: unknown
		let returnValue: (BreakageOutcome & { summary: string }) | undefined
		try {
			returnValue = await breakage({
				tagPattern: `my-library`,
				testPattern: `*__public.test.ts`,
				testCommand: `bun test *__public.test.ts`,
				certifyCommand: `bun ./certify-major-version.ts`,
				baseDirname: localRepoDirname,
				verbose: true,
			})
		} catch (thrown) {
			caught = thrown
			console.log(thrown)
		}
		expect(caught).toBeUndefined()
		expect(returnValue?.summary).toBe(
			`Breaking changes were found and certified.`,
		)
	})
})
