import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

import { expect, it } from "bun:test"

import { breakage } from "../src/breakage.ts"
import { runFile } from "../src/peer-install.ts"
import { peerProject } from "./peer-project.ts"

it(`installs exact peer artifacts and the packed candidate without using workspace installations`, async () => {
	const project = await peerProject(
		{ cases: [{ name: `placeholder`, peers: { host: `1.0.0` } }] },
		`import assert from "node:assert/strict"; import { message } from "fixture-plugin"; assert.equal(message(), "hello", "peer integration output");`,
	)
	try {
		const sources: Record<string, string> = {}
		for (const [version, message] of [
			[`1.0.0`, `hello`],
			[`1.1.0`, `broken`],
		]) {
			const directory = path.join(project.directory, `host-${version}`)
			await mkdir(directory)
			await writeFile(
				path.join(directory, `package.json`),
				JSON.stringify({
					name: `host`,
					version,
					type: `module`,
					main: `index.ts`,
				}),
			)
			await writeFile(
				path.join(directory, `index.ts`),
				`export const greeting = ${JSON.stringify(message)};`,
			)
			const artifact = path.join(project.directory, `host-${version}.tgz`)
			await runFile(`pnpm`, [`pack`, `--out`, artifact], directory)
			sources[`host@${version}`] = artifact
		}
		await project.write(
			`index.ts`,
			`import { greeting } from "host"; export const message = () => greeting;`,
		)
		await project.write(
			`package.json`,
			JSON.stringify({
				name: `fixture-plugin`,
				version: `1.0.1`,
				type: `module`,
				exports: `./index.ts`,
				peerDependencies: { host: `^1.0.0` },
			}),
		)
		await project.write(
			`peers.json`,
			JSON.stringify({
				install: true,
				sources,
				cases: [
					{ name: `old`, peers: { host: `1.0.0` } },
					{ name: `new`, peers: { host: `1.1.0` } },
				],
			}),
		)
		await project.write(`pnpm-lock.yaml`, `original developer lockfile\n`)
		await project.git.add(`.`).commit(`Prepare candidate`)
		await project.write(
			`node_modules/host/package.json`,
			JSON.stringify({ name: `host`, version: `9.0.0` }),
		)
		const result = await breakage(project.options)
		expect(result).toMatchObject({
			success: false,
			peerResults: [{ status: `passed` }, { status: `contract-failed` }],
		})
		if (!(`peerResults` in result)) throw new Error(`Missing peer report`)
		expect(result.peerResults[1]!.stderr).toContain(`peer integration output`)
		expect(
			await readFile(path.join(project.repository, `pnpm-lock.yaml`), `utf8`),
		).toBe(`original developer lockfile\n`)
		expect(
			JSON.parse(
				await readFile(
					path.join(project.repository, `node_modules/host/package.json`),
					`utf8`,
				),
			).version,
		).toBe(`9.0.0`)
		expect((await project.git.status()).isClean()).toBe(true)
	} finally {
		await project.cleanup()
	}
}, 30000)
