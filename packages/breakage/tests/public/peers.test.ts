import path from "node:path"

import { expect, it } from "bun:test"
import { breakage, breakagePrelude } from "breakage"

import { fixture, git } from "./fixture.ts"

it(`reports peer regressions against current embassy assertions through the API and CLI`, async () => {
	const project = fixture()
	try {
		project.write(
			`package.json`,
			JSON.stringify({
				name: `consumer-plugin`,
				version: `1.0.0`,
				peerDependencies: { host: `^1.0.0` },
				devDependencies: {
					host_v1: `npm:host@1.0.0`,
					host_v1_1: `npm:host@1.1.0`,
				},
			}),
		)
		project.write(
			`public/contract.ts`,
			`import assert from "node:assert/strict"; assert.equal(JSON.parse(process.env.BREAKAGE_PEERS).host, "1.0.0", "released peer behavior");`,
		)
		git(project.repository, `add`, `.`)
		git(project.repository, `commit`, `-m`, `Release peer contracts`)
		git(project.repository, `tag`, `peer@1.0.0`)
		git(project.repository, `push`, `--tags`, `origin`)
		project.write(
			`public/contract.ts`,
			`import assert from "node:assert/strict"; assert.equal(JSON.parse(process.env.BREAKAGE_PEERS).host, "1.0.0", "current embassy promise");`,
		)
		const options = {
			baseDirname: project.repository,
			embassies: {
				host: {
					testPattern: `public/**/*`,
					testCommand: `"${process.execPath}" public/contract.ts`,
				},
			},
			peerOptions: { prepareCommand: `"${process.execPath}" prepare.ts` },
		}
		project.write(
			`prepare.ts`,
			`import { mkdir, writeFile } from "node:fs/promises";
const version = JSON.parse(process.env.BREAKAGE_PEERS).host;
await mkdir("node_modules/host", { recursive: true });
await writeFile("node_modules/host/package.json", JSON.stringify({ name: "host", version, main: "index.ts" }));
await writeFile("node_modules/host/index.ts", "export const value = true;");`,
		)
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
				{
					name: `host: host@1.0.0`,
					peers: { host: `1.0.0` },
					status: `passed`,
				},
				{
					name: `host: host@1.1.0`,
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
		expect(project.read(`public/contract.ts`)).toContain(
			`current embassy promise`,
		)
	} finally {
		project.cleanup()
	}
})

it(`prints actionable pin diagnostics and exits 2 before running an embassy`, () => {
	const project = fixture()
	try {
		project.write(
			`package.json`,
			JSON.stringify({
				name: `consumer-plugin`,
				peerDependencies: { host: `^1 || >=2` },
				devDependencies: {
					host_v1: `npm:host@1.0.0`,
					host_v2: `npm:other@2.0.0`,
				},
			}),
		)
		project.write(`embassy.ts`, `throw new Error("must not run");`)
		project.write(
			`breakage.config.json`,
			JSON.stringify({
				embassies: {
					host: { testPattern: `embassy.ts`, testCommand: `false` },
				},
			}),
		)
		git(project.repository, `add`, `.`)
		git(project.repository, `commit`, `-m`, `Invalid pinned mapping`)
		const configured = process.env.BREAKAGE_CLI_ENTRYPOINT
		if (!configured) throw new Error(`BREAKAGE_CLI_ENTRYPOINT is required`)
		const cli = Bun.spawnSync(
			[process.execPath, path.resolve(configured), `--`],
			{ cwd: project.repository },
		)
		expect(cli.exitCode).toBe(2)
		expect(cli.stderr.toString()).toContain(`devDependencies["host_v2"]`)
		expect(cli.stderr.toString()).toContain(`must target peer host`)
		expect(cli.stderr.toString()).toContain(
			`no pinned development alias satisfying group ">=2"`,
		)
		expect(cli.stderr.toString()).not.toContain(`must not run`)
		expect(cli.stderr.toString()).not.toContain(`at <anonymous>`)
	} finally {
		project.cleanup()
	}
})
