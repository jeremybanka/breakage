import { rejects } from "node:assert/strict"
import { readFile, rename } from "node:fs/promises"
import path from "node:path"

import { expect, it } from "bun:test"

import { breakage, breakagePrelude } from "../src/breakage.ts"
import { selectPeerVersions } from "../src/peer-plan.ts"
import { peerProject } from "./peer-project.ts"

it(`samples lower and upper published versions per range segment and compatibility line`, () => {
	expect(
		selectPeerVersions(`^2.4.0 || ^3.1.0`, [
			`2.3.0`,
			`2.4.0`,
			`2.5.0`,
			`3.0.0`,
			`3.1.0`,
			`3.7.0`,
			`4.0.0-beta.1`,
		]),
	).toEqual([`2.4.0`, `2.5.0`, `3.1.0`, `3.7.0`])
	expect(
		selectPeerVersions(`>=0.2.0 <0.4.0`, [`0.2.0`, `0.2.5`, `0.3.0`, `0.3.9`]),
	).toEqual([`0.2.0`, `0.2.5`, `0.3.0`, `0.3.9`])
	expect(() => selectPeerVersions(`^5.0.0`, [`4.0.0`])).toThrow(
		`No published stable peer versions`,
	)
})

it(`pins discovered versions deterministically and replays without registry or origin discovery`, async () => {
	let published = [`1.0.0`, `1.1.0`]
	const server = Bun.serve({
		port: 0,
		hostname: `127.0.0.1`,
		fetch() {
			return Response.json({
				name: `host`,
				"dist-tags": { latest: published[published.length - 1] },
				versions: Object.fromEntries(
					published.map((version) => [
						version,
						{
							name: `host`,
							version,
							dist: { tarball: `http://127.0.0.1/unused.tgz` },
						},
					]),
				),
			})
		},
	})
	const project = await peerProject({ resolve: true })
	try {
		await project.write(`.npmrc`, `registry=http://127.0.0.1:${server.port}/\n`)
		await project.git.add(`.`).commit(`Use test registry`)
		const out = `.breakage/peer-baseline.json`
		const first = await breakagePrelude({ ...project.options, out })
		expect(first.peers?.cases.map((entry) => entry.peers.host)).toEqual([
			`1.0.0`,
			`1.1.0`,
		])
		const bytes = await readFile(path.join(project.repository, out), `utf8`)
		await breakagePrelude({ ...project.options, out })
		expect(await readFile(path.join(project.repository, out), `utf8`)).toBe(
			bytes,
		)
		published = [...published, `1.2.0`]
		await breakagePrelude({ ...project.options, out })
		expect(await readFile(path.join(project.repository, out), `utf8`)).not.toBe(
			bytes,
		)
		server.stop(true)
		await rename(
			path.join(project.directory, `remote.git`),
			path.join(project.directory, `offline.git`),
		)
		const result = await breakage({ ...project.options, baselineFile: out })
		expect(result).toMatchObject({
			peerResults: [
				{ peers: { host: `1.0.0` }, status: `passed` },
				{ peers: { host: `1.2.0` }, status: `contract-failed` },
			],
		})
		await project.write(
			`peers.json`,
			JSON.stringify({ resolve: true, setupCommand: `true` }),
		)
		await project.git.add(`.`).commit(`Change matrix`)
		await rejects(
			breakage({ ...project.options, baselineFile: out }),
			/another configuration or candidate commit/,
		)
	} finally {
		server.stop(true)
		await project.cleanup()
	}
}, 30000)
