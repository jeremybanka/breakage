import { expect, it } from "bun:test"

import { breakage, breakagePrelude } from "../src/breakage.ts"
import { peerProject } from "./peer-project.ts"

it(`swaps pinned workspace releases and their historical dependencies while keeping the candidate and embassy current`, async () => {
	const project = await peerProject(
		{
			install: true,
			workspace: { host: { directory: `packages/host`, tagPattern: `^host@` } },
		},
		`throw new Error("Old suite must never run");`,
	)
	try {
		await project.write(`pnpm-workspace.yaml`, `packages:\n  - 'packages/*'\n`)
		await project.write(
			`package.json`,
			JSON.stringify({
				name: `fixture-plugin`,
				version: `1.0.0`,
				type: `module`,
				exports: `./index.ts`,
				peerDependencies: { host: `1.0.0 || ^2` },
				devDependencies: {
					host_v1: `npm:host@1.0.0`,
					host_v2: `npm:host@2.0.0`,
				},
			}),
		)
		await project.write(
			`index.ts`,
			`import { message } from "host"; export const integration = () => "current:" + message;`,
		)
		for (const version of [`1.0.0`, `2.0.0`]) {
			await project.write(
				`packages/host/package.json`,
				JSON.stringify({
					name: `host`,
					version,
					type: `module`,
					exports: `./index.ts`,
					dependencies: { "@fixture/helper": `workspace:*` },
				}),
			)
			await project.write(
				`packages/host/index.ts`,
				`export { message } from "@fixture/helper";`,
			)
			await project.write(
				`packages/helper/package.json`,
				JSON.stringify({
					name: `@fixture/helper`,
					version,
					type: `module`,
					exports: `./index.ts`,
				}),
			)
			await project.write(
				`packages/helper/index.ts`,
				`export const message = "${version}";`,
			)
			await project.git
				.add(`.`)
				.commit(`Host release ${version}`)
				.addTag(`host@${version}`)
		}
		await project.write(
			`packages/host/index.ts`,
			`throw new Error("Current workspace peer must not leak");`,
		)
		await project.write(
			`public/contract.ts`,
			`import assert from "node:assert/strict"; import { integration } from "fixture-plugin"; assert.equal(integration(), "current:" + JSON.parse(process.env.BREAKAGE_PEERS).host);`,
		)
		await project.git.add(`.`).commit(`Current candidate and embassy`)
		await project.git.push(`origin`, `--tags`)
		await project.git.tag([`-d`, `host@2.0.0`])
		const out = `.breakage/workspace.json`
		const plan = await breakagePrelude({ ...project.options, out })
		expect(Object.keys(plan.peers!.installations!)).toHaveLength(2)
		await project.git.removeRemote(`origin`)
		await project.git.tag([`-d`, `host@1.0.0`, `host@2.0.0`])
		expect(
			await breakage({ ...project.options, baselineFile: out }),
		).toMatchObject({
			success: true,
			peerResults: [
				{ contract: `current`, status: `passed` },
				{ contract: `current`, status: `passed` },
			],
		})
		expect((await project.git.status()).isClean()).toBe(true)
		// A fresh plan must not substitute current workspace code for a missing release.
		const missing = await breakage(project.options)
		expect(missing).toMatchObject({
			success: false,
			peerResults: [{ status: `setup-failed` }, { status: `setup-failed` }],
		})
		if (!(`peerResults` in missing)) throw new Error(`Missing report`)
		expect(missing.peerResults[0]!.stderr).toContain(
			`needs exactly one matching release tag`,
		)
	} finally {
		await project.cleanup()
	}
}, 30000)
