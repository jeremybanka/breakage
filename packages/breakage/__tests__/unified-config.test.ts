import { rejects } from "node:assert/strict"
import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"

import { expect, it } from "bun:test"

import { breakage, breakagePrelude } from "../src/breakage.ts"
import { validatePeerConfig } from "../src/peer-config.ts"
import { peerProject } from "./peer-project.ts"

it(`runs public history and current embassies from one configuration and one snapshot`, async () => {
	const project = await peerProject(
		{},
		`throw new Error("historical public contract");`,
	)
	try {
		await project.write(
			`public/contract.ts`,
			`// Current embassy passes for every pin.\n`,
		)
		await project.git.add(`.`).commit(`Update current embassy`)
		const embassyOnly = project.options
		const options = {
			...embassyOnly,
			testPattern: `public/**/*`,
			testCommand: `"${process.execPath}" public/contract.ts`,
			certifyCommand: `false`,
		}
		await writeFile(
			path.join(project.repository, `breakage.config.json`),
			JSON.stringify(options),
		)
		await project.git.add(`.`).commit(`Configure both relationships`)
		const out = `.breakage/baseline.json`
		const baseline = await breakagePrelude({ ...options, out })
		expect(baseline.ref).toBe(`refs/tags/plugin@1.0.0`)
		expect(baseline.peers?.environments).toHaveLength(2)
		const report = await breakage({ ...options, baselineFile: out })
		expect(report).toMatchObject({
			success: false,
			peerResults: [{ status: `passed` }, { status: `passed` }],
			publicResult: {
				breakingChangesFound: true,
				breakingChangesCertified: false,
			},
		})
		if (
			!(`publicResult` in report) ||
			!report.publicResult ||
			!(`testResult` in report.publicResult)
		)
			throw new Error(`Missing public result`)
		expect(report.publicResult.testResult).toContain(
			`historical public contract`,
		)
		expect(
			await readFile(
				path.join(project.repository, `public/contract.ts`),
				`utf8`,
			),
		).toContain(`Current embassy`)
		const cli = Bun.spawnSync(
			[
				process.execPath,
				path.resolve(
					process.env.BREAKAGE_CLI_ENTRYPOINT ?? `src/breakage.x.ts`,
				),
				`--`,
				`--baseline-file=${out}`,
			],
			{ cwd: project.repository },
		)
		expect(cli.exitCode).toBe(1)
		expect(JSON.parse(cli.stdout.toString())).toMatchObject({
			success: false,
			publicResult: { breakingChangesFound: true },
			peerResults: [{ status: `passed` }, { status: `passed` }],
		})
		expect((await project.git.status()).isClean()).toBe(true)
		await rejects(
			breakage({ ...embassyOnly, baselineFile: out }),
			/Run breakage prelude again/,
		)
		await rejects(
			breakagePrelude({
				...embassyOnly,
				out: `.breakage/peers.json`,
				testPattern: `public/**/*`,
			}),
			/Failed to prepare baseline/,
		)
	} finally {
		await project.cleanup()
	}
})

it(`rejects authored environments and case names`, () => {
	expect(() =>
		validatePeerConfig({
			cases: [{ name: `manual`, peers: { react: `19.2.1` } }],
		}),
	).toThrow(`Remove cases`)
	expect(() => validatePeerConfig({ environments: [] })).toThrow(
		`Unknown peer configuration option`,
	)
})
