import { rejects } from "node:assert/strict"
import { readFile } from "node:fs/promises"
import path from "node:path"

import { expect, it } from "bun:test"

import { breakage, breakagePrelude } from "../src/breakage.ts"
import { peerProject } from "./peer-project.ts"

it(`pins only manifest representatives without registry discovery or a public release baseline`, async () => {
	const project = await peerProject({})
	try {
		await project.git.removeRemote(`origin`)
		await project.git.tag([`-d`, `plugin@1.0.0`])
		await project.write(`.npmrc`, `registry=http://127.0.0.1:1/\n`)
		await project.git.add(`.`).commit(`Disable registry`)
		const out = `.breakage/peer-baseline.json`
		const first = await breakagePrelude({ ...project.options, out })
		expect(first.peers?.environments.map((entry) => entry.peers.host)).toEqual([
			`1.0.0`,
			`1.1.0`,
		])
		const bytes = await readFile(path.join(project.repository, out), `utf8`)
		await breakagePrelude({ ...project.options, out })
		expect(await readFile(path.join(project.repository, out), `utf8`)).toBe(
			bytes,
		)
		expect(
			await breakage({ ...project.options, baselineFile: out }),
		).toMatchObject({
			peerResults: [{ status: `passed` }, { status: `contract-failed` }],
		})
		await rejects(
			breakage({
				...project.options,
				baselineFile: out,
				embassies: {
					host: { testPattern: `public/**/*`, testCommand: `true` },
				},
			}),
			/another configuration or candidate commit/,
		)
		await project.write(
			`package.json`,
			JSON.stringify({
				name: `fixture-plugin`,
				peerDependencies: { host: `>=1` },
				devDependencies: {
					host_v1: `npm:host@1.0.0`,
					host_v19_future: `npm:host@2.0.1`,
				},
			}),
		)
		await project.git.add(`.`).commit(`Renovate updates one pin`)
		await rejects(
			breakage({ ...project.options, baselineFile: out }),
			/another configuration or candidate commit/,
		)
		const next = await breakagePrelude({ ...project.options, out })
		expect(next.peers?.environments.map((entry) => entry.peers.host)).toEqual([
			`1.0.0`,
			`2.0.1`,
		])
	} finally {
		await project.cleanup()
	}
})
