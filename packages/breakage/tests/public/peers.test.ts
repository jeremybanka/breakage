import path from "node:path"

import { expect, it } from "bun:test"
import { breakage, breakagePrelude } from "breakage"

import { fixture, git } from "./fixture.ts"

it(`reports peer regressions against released assertions through the API and CLI`, async () => {
	const project = fixture()
	try {
		project.write(
			`package.json`,
			JSON.stringify({
				name: `consumer-plugin`,
				version: `1.0.0`,
				peerDependencies: { host: `^1.0.0` },
			}),
		)
		project.write(
			`public/contract.ts`,
			`import assert from "node:assert/strict"; assert.equal(JSON.parse(process.env.BREAKAGE_PEERS).host, "1.0.0", "released peer behavior");`,
		)
		project.write(
			`peers.json`,
			JSON.stringify({
				cases: [
					{ name: `working`, peers: { host: `1.0.0` } },
					{ name: `regression`, peers: { host: `1.1.0` } },
				],
			}),
		)
		git(project.repository, `add`, `.`)
		git(project.repository, `commit`, `-m`, `Release peer contracts`)
		git(project.repository, `tag`, `peer@1.0.0`)
		git(project.repository, `push`, `--tags`, `origin`)
		project.write(
			`public/contract.ts`,
			`// A new assertion cannot erase the released promise.\n`,
		)
		const options = {
			...project.options,
			tagPattern: `peer@`,
			peerConfig: `peers.json`,
			certifyCommand: `true`,
		}
		project.write(`breakage.config.json`, JSON.stringify(options))
		git(project.repository, `add`, `.`)
		git(project.repository, `commit`, `-m`, `Current contracts`)
		const baselineFile = `.breakage/peer-baseline.json`
		await breakagePrelude({ ...options, out: baselineFile })
		const result = await breakage({ ...options, baselineFile })
		expect(result).toMatchObject({
			peerCheck: true,
			success: false,
			peerResults: [
				{ name: `working`, peers: { host: `1.0.0` }, status: `passed` },
				{
					name: `regression`,
					peers: { host: `1.1.0` },
					status: `contract-failed`,
				},
			],
		})
		const configured = process.env.BREAKAGE_CLI_ENTRYPOINT
		if (!configured) throw new Error(`BREAKAGE_CLI_ENTRYPOINT is required`)
		const cli = Bun.spawnSync(
			[
				process.execPath,
				path.resolve(configured),
				`--`,
				`--baseline-file=${baselineFile}`,
			],
			{ cwd: project.repository },
		)
		expect(cli.exitCode).toBe(1)
		expect(JSON.parse(cli.stdout.toString())).toMatchObject({
			success: false,
			peerResults: [{ status: `passed` }, { status: `contract-failed` }],
		})
		expect(project.read(`public/contract.ts`)).toContain(`A new assertion`)
	} finally {
		project.cleanup()
	}
})
