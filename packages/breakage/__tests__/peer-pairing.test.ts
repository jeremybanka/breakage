import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

import { expect, it } from "bun:test"

import { breakage, breakagePrelude } from "../src/breakage.ts"
import { runFile } from "../src/peer-install.ts"
import { peerProject } from "./peer-project.ts"

it(`infers compatible pairs within a major from dependency requirements and replays them without manual cases`, async () => {
	const project = await peerProject(
		{ install: true },
		`import assert from "node:assert/strict"; import { value } from "fixture-plugin"; assert.equal(value, JSON.parse(process.env.BREAKAGE_PEERS).host);`,
	)
	try {
		const sources: Record<string, string> = {}
		for (const [name, version, requirement] of [
			[`host`, `1.2.3`, undefined],
			[`host`, `1.8.2`, undefined],
			[`adapter`, `5.0.0`, `~1.2`],
			[`adapter`, `5.2.0`, `^1.8`],
		] as const) {
			const directory = path.join(project.directory, `${name}-${version}`)
			await mkdir(directory)
			await writeFile(
				path.join(directory, `package.json`),
				JSON.stringify({
					name,
					version,
					main: `index.ts`,
					...(requirement ? { peerDependencies: { host: requirement } } : {}),
				}),
			)
			await writeFile(
				path.join(directory, `index.ts`),
				name === `host`
					? `export const value = "${version}";`
					: `export { value } from "host";`,
			)
			const archive = path.join(project.directory, `${name}-${version}.tgz`)
			await runFile(`pnpm`, [`pack`, `--out`, archive], directory)
			sources[`${name}@${version}`] = archive
		}
		await project.write(
			`package.json`,
			JSON.stringify({
				name: `fixture-plugin`,
				version: `1.0.0`,
				type: `module`,
				exports: `./index.ts`,
				peerDependencies: { host: `~1.2 || ^1.8`, adapter: `5.0.0 || ~5.2` },
				devDependencies: {
					host_v1_recent: `npm:host@1.8.2`,
					host_v1_earlier: `npm:host@1.2.3`,
					adapter_v5_original: `npm:adapter@5.0.0`,
					adapter_v5_updated: `npm:adapter@5.2.0`,
				},
			}),
		)
		await project.write(`index.ts`, `export { value } from "adapter";`)
		await project.write(
			`breakage.config.json`,
			JSON.stringify({ install: true, sources }),
		)
		await project.git.add(`.`).commit(`Declare irregular eras and pins`)
		const out = `.breakage/pairs.json`
		const baseline = await breakagePrelude({ ...project.options, out })
		expect(baseline.peers?.environments.map(({ peers }) => peers)).toEqual([
			{ adapter: `5.0.0`, host: `1.2.3` },
			{ adapter: `5.2.0`, host: `1.8.2` },
		])
		expect(baseline.peers?.excluded).toHaveLength(2)
		const report = await breakage({ ...project.options, baselineFile: out })
		expect(report).toMatchObject({
			success: true,
			peerResults: [{ status: `passed` }, { status: `passed` }],
		})
		expect((await project.git.status()).isClean()).toBe(true)
	} finally {
		await project.cleanup()
	}
}, 30000)
