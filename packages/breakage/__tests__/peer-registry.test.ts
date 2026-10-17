import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

import { expect, it } from "bun:test"

import { breakage, breakagePrelude } from "../src/breakage.ts"
import { runFile } from "../src/peer-install.ts"
import { peerProject } from "./peer-project.ts"

it(`installs pinned registry representatives and ignores newer advertised releases`, async () => {
	const project = await peerProject(
		{ installer: `pnpm` },
		`import assert from "node:assert/strict"; import { value } from "fixture-plugin"; assert.equal(value, JSON.parse(process.env.BREAKAGE_PEERS).host);`,
	)
	let server: ReturnType<typeof Bun.serve> | undefined
	try {
		const archives = new Map<string, Buffer>()
		for (const version of [`1.0.0`, `1.1.0`, `2.0.0`]) {
			const directory = path.join(project.directory, `host-${version}`)
			await mkdir(directory)
			await writeFile(
				path.join(directory, `package.json`),
				JSON.stringify({ name: `host`, version, main: `index.ts` }),
			)
			await writeFile(
				path.join(directory, `index.ts`),
				`export const value = "${version}";`,
			)
			const archive = path.join(project.directory, `${version}.tgz`)
			await runFile(`pnpm`, [`pack`, `--out`, archive], directory)
			archives.set(version, await readFile(archive))
		}
		const downloads: string[] = []
		server = Bun.serve({
			port: 0,
			hostname: `127.0.0.1`,
			fetch(request) {
				const url = new URL(request.url)
				if (url.pathname.endsWith(`.tgz`)) {
					const version = path.basename(url.pathname, `.tgz`)
					downloads.push(version)
					return new Response(archives.get(version))
				}
				return Response.json({
					name: `host`,
					"dist-tags": { latest: `2.0.0` },
					versions: Object.fromEntries(
						[...archives].map(([version, archive]) => [
							version,
							{
								name: `host`,
								version,
								main: `index.ts`,
								dist: {
									tarball: `${url.origin}/${version}.tgz`,
									integrity: `sha512-${createHash(`sha512`).update(archive).digest(`base64`)}`,
								},
							},
						]),
					),
				})
			},
		})
		await project.write(`.npmrc`, `registry=http://127.0.0.1:${server.port}/\n`)
		await project.write(
			`package.json`,
			JSON.stringify({
				name: `fixture-plugin`,
				version: `1.0.0`,
				type: `module`,
				exports: `./index.ts`,
				peerDependencies: { host: `>=1` },
				devDependencies: {
					host_v1: `npm:host@1.0.0`,
					host_v1_latest: `npm:host@1.1.0`,
				},
			}),
		)
		await project.write(`index.ts`, `export { value } from "host";`)
		// A fixture with the same name is not a workspace member.
		await project.write(
			`fixtures/host/package.json`,
			JSON.stringify({ name: `host`, version: `9.0.0` }),
		)
		await project.git.add(`.`).commit(`Use pinned registry peers`)
		const out = `.breakage/registry.json`
		const snapshot = await breakagePrelude({ ...project.options, out })
		expect(
			snapshot.peers!.environments.map((entry) => entry.peers.host),
		).toEqual([`1.0.0`, `1.1.0`])
		expect(
			await breakage({ ...project.options, baselineFile: out }),
		).toMatchObject({
			success: true,
			peerResults: [
				{ peers: { host: `1.0.0` }, status: `passed` },
				{ peers: { host: `1.1.0` }, status: `passed` },
			],
		})
		expect(downloads).not.toContain(`2.0.0`)
		expect((await project.git.status()).isClean()).toBe(true)
	} finally {
		await server?.stop(true)
		await project.cleanup()
	}
}, 30000)
