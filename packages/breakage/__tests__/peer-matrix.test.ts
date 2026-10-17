import { rejects } from "node:assert/strict"
import { readFile } from "node:fs/promises"
import path from "node:path"

import { expect, it } from "bun:test"

import { breakage } from "../src/breakage.ts"
import { peerProject } from "./peer-project.ts"

it(`runs named exact cases with released assertions and reports the failed combination`, async () => {
	const project = await peerProject({
		cases: [
			{ name: `old`, peers: { host: `1.0.0` } },
			{ name: `new`, peers: { host: `1.1.0` } },
		],
	})
	try {
		await project.write(
			`public/contract.ts`,
			`// Current assertions would pass every case.\n`,
		)
		await project.git.add(`.`).commit(`Weaken current assertions`)
		const result = await breakage(project.options)
		expect(result).toMatchObject({
			peerCheck: true,
			success: false,
			peerResults: [
				{ name: `old`, status: `passed` },
				{ name: `new`, status: `contract-failed` },
			],
		})
		if (!(`peerResults` in result)) throw new Error(`Missing peer report`)
		expect(result.peerResults[1]!.stderr).toContain(`released peer contract`)
		expect(
			await readFile(
				path.join(project.repository, `public/contract.ts`),
				`utf8`,
			),
		).toContain(`Current assertions`)
		expect((await project.git.status()).isClean()).toBe(true)
	} finally {
		await project.cleanup()
	}
})

it(`distinguishes setup failures and continues through all cases`, async () => {
	const project = await peerProject({
		setupCommand: `echo setup-broke >&2; exit 3`,
		cases: [
			{ name: `one`, peers: { host: `1.0.0` } },
			{ name: `two`, peers: { host: `1.1.0` } },
		],
	})
	try {
		const result = await breakage(project.options)
		expect(result).toMatchObject({
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

it(`rejects ranges in explicit cases and restores the original checkout`, async () => {
	const project = await peerProject({
		cases: [{ name: `range`, peers: { host: `^1` } }],
	})
	try {
		await rejects(breakage(project.options), /exact version/)
		expect((await project.git.status()).isClean()).toBe(true)
	} finally {
		await project.cleanup()
	}
})
