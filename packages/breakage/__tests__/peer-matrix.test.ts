import { rejects } from "node:assert/strict"
import { readFile } from "node:fs/promises"
import path from "node:path"

import { expect, it } from "bun:test"

import { breakage } from "../src/breakage.ts"
import { peerProject } from "./peer-project.ts"

it(`uses current embassy assertions for every pin while overlapping public tests retain their historical contract`, async () => {
	const project = await peerProject(
		{},
		`throw new Error("historical public promise");`,
	)
	try {
		await project.write(
			`public/contract.ts`,
			`import assert from "node:assert/strict"; assert.equal(JSON.parse(process.env.BREAKAGE_PEERS).host, "1.1.0", "current embassy promise");`,
		)
		await project.git.add(`.`).commit(`Evolve the embassy`)
		const result = await breakage(project.options)
		expect(result).toMatchObject({
			success: false,
			peerResults: [
				{ contract: `current`, status: `contract-failed` },
				{ contract: `current`, status: `passed` },
			],
		})
		if (!(`peerResults` in result)) throw new Error(`Missing report`)
		expect(result.peerResults[0]!.stderr).toContain(`current embassy promise`)
		const { embassies: _, peerOptions: __, ...publicOptions } = project.options
		const publicResult = await breakage({
			...publicOptions,
			testPattern: `public/**/*`,
			testCommand: `"${process.execPath}" public/contract.ts`,
			certifyCommand: `false`,
		})
		expect(publicResult).toMatchObject({
			breakingChangesFound: true,
			breakingChangesCertified: false,
		})
		if (!(`testResult` in publicResult))
			throw new Error(`Missing public report`)
		expect(publicResult.testResult).toContain(`historical public promise`)
		expect(
			await readFile(
				path.join(project.repository, `public/contract.ts`),
				`utf8`,
			),
		).toContain(`current embassy promise`)
		expect((await project.git.status()).isClean()).toBe(true)
	} finally {
		await project.cleanup()
	}
})

it(`runs embassy configuration without public options, release tags, or origin`, async () => {
	const project = await peerProject(
		{
			embassies: {
				host: {
					testPattern: `public/**/*`,
					testCommand: `"${process.execPath}" public/contract.ts`,
				},
			},
		},
		`// Current embassy succeeds.\n`,
	)
	try {
		await project.git.removeRemote(`origin`)
		await project.git.tag([`-d`, `plugin@1.0.0`])
		expect(
			await breakage({
				baseDirname: project.repository,
				...project.options,
			}),
		).toMatchObject({
			success: true,
			peerResults: [
				{ embassy: `host`, contract: `current` },
				{ embassy: `host`, contract: `current` },
			],
		})
	} finally {
		await project.cleanup()
	}
})

it(`distinguishes setup failures and continues through every pin`, async () => {
	const project = await peerProject({
		setupCommand: `echo setup-broke >&2; exit 3`,
	})
	try {
		expect(await breakage(project.options)).toMatchObject({
			success: false,
			peerResults: [
				{ status: `setup-failed`, stderr: `setup-broke\n` },
				{ status: `setup-failed`, stderr: `setup-broke\n` },
			],
		})
	} finally {
		await project.cleanup()
	}
})

it(`fails before execution on uncovered mappings or empty current test selections`, async () => {
	const project = await peerProject({})
	try {
		await rejects(
			breakage({
				...project.options,
				embassies: {
					host: { testPattern: `missing/**/*`, testCommand: `true` },
				},
			}),
			/selected no current tests/,
		)
		await project.write(
			`package.json`,
			JSON.stringify({
				peerDependencies: { host: `^1 || ^2` },
				devDependencies: { host_v1: `npm:host@1.0.0` },
			}),
		)
		await project.git.add(`.`).commit(`Uncovered range`)
		await rejects(
			breakage(project.options),
			/no pinned development alias satisfying group "\^2"/,
		)
		expect((await project.git.status()).isClean()).toBe(true)
	} finally {
		await project.cleanup()
	}
})
