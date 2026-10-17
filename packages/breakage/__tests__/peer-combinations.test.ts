import { rejects } from "node:assert/strict"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

import { expect, it } from "bun:test"

import { breakage } from "../src/breakage.ts"
import { runFile } from "../src/peer-install.ts"
import { resolvePeerCases } from "../src/peer-plan.ts"
import { readPeerSupport } from "../src/peer-support.ts"
import { peerProject } from "./peer-project.ts"

it(`expands multiple peers with optional absence and refuses to truncate the matrix`, async () => {
	const config = {
		resolve: true,
		sources: {
			"host@1.0.0": `host-1.tgz`,
			"host@1.1.0": `host-2.tgz`,
			"adapter@2.0.0": `adapter-1.tgz`,
			"adapter@2.1.0": `adapter-2.tgz`,
		},
	}
	const support = {
		ranges: { host: `^1.0.0`, adapter: `^2.0.0` },
		optional: [`adapter`],
	}
	const cases = await resolvePeerCases(config, support, process.cwd())
	expect(cases).toHaveLength(6)
	expect(cases.filter((entry) => entry.peers.adapter === null)).toHaveLength(2)
	await rejects(
		resolvePeerCases({ ...config, maxCases: 5 }, support, process.cwd()),
		/exceeds maxCases/,
	)
	expect(
		await resolvePeerCases(
			{ cases: [{ name: `minimal`, peers: { host: `1.0.0` } }] },
			support,
			process.cwd(),
		),
	).toEqual([{ name: `minimal`, peers: { host: `1.0.0`, adapter: null } }])
	await rejects(
		resolvePeerCases(
			{ cases: [{ name: `missing-host`, peers: { adapter: `2.0.0` } }] },
			support,
			process.cwd(),
		),
		/omits a required peer/,
	)
})

it(`requires deliberate policies for prereleases and unbounded automatic selection`, async () => {
	const config = {
		resolve: true,
		sources: { "host@1.0.0": `one.tgz`, "host@2.0.0-beta.1": `beta.tgz` },
	}
	const support = { ranges: { host: `>=1.0.0` }, optional: [] }
	await rejects(
		resolvePeerCases(config, support, process.cwd()),
		/Unbounded peer range/,
	)
	const cases = await resolvePeerCases(
		{ ...config, unbounded: `published`, prereleases: `include` },
		support,
		process.cwd(),
	)
	expect(cases.map((entry) => entry.peers.host)).toEqual([
		`1.0.0`,
		`2.0.0-beta.1`,
	])
})

it(`resolves workspace range shorthand independently at each commit`, async () => {
	const project = await peerProject({
		cases: [{ name: `one`, peers: { host: `1.0.0` } }],
	})
	try {
		await project.write(
			`package.json`,
			JSON.stringify({
				name: `fixture-plugin`,
				peerDependencies: { host: `workspace:^` },
			}),
		)
		await project.write(
			`packages/host/package.json`,
			JSON.stringify({ name: `host`, version: `2.4.0` }),
		)
		await project.git.add(`.`).commit(`Workspace version two`)
		const released = await project.git.revparse([`HEAD`])
		await project.write(
			`packages/host/package.json`,
			JSON.stringify({ name: `host`, version: `3.1.0` }),
		)
		await project.git.add(`.`).commit(`Workspace version three`)
		expect(
			(await readPeerSupport(project.git, released, `package.json`)).ranges
				.host,
		).toBe(`^2.4.0`)
		expect(
			(await readPeerSupport(project.git, `HEAD`, `package.json`)).ranges.host,
		).toBe(`^3.1.0`)
	} finally {
		await project.cleanup()
	}
})

it(`runs an optional peer absence case without leaking the developer's installed peer`, async () => {
	const project = await peerProject(
		{ install: true, cases: [{ name: `absent`, peers: { host: null } }] },
		`import assert from "node:assert/strict"; import { message } from "fixture-plugin"; assert.equal(await message(), "fallback");`,
	)
	try {
		await project.write(
			`package.json`,
			JSON.stringify({
				name: `fixture-plugin`,
				version: `1.1.0`,
				type: `module`,
				exports: `./index.ts`,
				peerDependencies: { host: `^1.0.0` },
				peerDependenciesMeta: { host: { optional: true } },
			}),
		)
		await project.write(
			`index.ts`,
			`export async function message() { try { return (await import("host")).greeting } catch (error) { if (error.code === "ERR_MODULE_NOT_FOUND") return "fallback"; throw error } }`,
		)
		await project.git.add(`.`).commit(`Allow host absence`)
		await project.write(
			`node_modules/host/package.json`,
			JSON.stringify({ name: `host`, version: `1.0.0`, main: `index.ts` }),
		)
		await project.write(
			`node_modules/host/index.ts`,
			`export const greeting = "leaked";`,
		)
		expect(await breakage(project.options)).toMatchObject({
			success: true,
			peerResults: [
				{ peers: { host: null }, contract: `current`, status: `passed` },
			],
		})
	} finally {
		await project.cleanup()
	}
}, 30000)

it(`reports mutually incompatible peer packages as setup failures`, async () => {
	const project = await peerProject(
		{
			install: true,
			cases: [
				{ name: `incompatible`, peers: { host: `1.0.0`, adapter: `2.0.0` } },
			],
		},
		`throw new Error("The contract must not run after an invalid installation");`,
	)
	try {
		const sources: Record<string, string> = {}
		for (const [name, version] of [
			[`host`, `1.0.0`],
			[`adapter`, `2.0.0`],
		]) {
			const directory = path.join(project.directory, name!)
			await mkdir(directory)
			await writeFile(
				path.join(directory, `package.json`),
				JSON.stringify({
					name,
					version,
					main: `index.ts`,
					...(name === `adapter`
						? { peerDependencies: { host: `^2.0.0` } }
						: {}),
				}),
			)
			await writeFile(
				path.join(directory, `index.ts`),
				`export const value = true;`,
			)
			const artifact = path.join(project.directory, `${name}.tgz`)
			await runFile(`pnpm`, [`pack`, `--out`, artifact], directory)
			sources[`${name}@${version}`] = artifact
		}
		await project.write(`index.ts`, `export const value = true;`)
		await project.write(
			`package.json`,
			JSON.stringify({
				name: `fixture-plugin`,
				version: `2.0.0`,
				main: `index.ts`,
				peerDependencies: { host: `^1.0.0`, adapter: `^2.0.0` },
			}),
		)
		await project.write(
			`peers.json`,
			JSON.stringify({
				install: true,
				sources,
				cases: [
					{ name: `incompatible`, peers: { host: `1.0.0`, adapter: `2.0.0` } },
				],
			}),
		)
		await project.git.add(`.`).commit(`Declare both integrations`)
		const result = await breakage(project.options)
		expect(result).toMatchObject({
			success: false,
			peerResults: [{ status: `setup-failed` }],
		})
		if (!(`peerResults` in result)) throw new Error(`Missing report`)
		expect(result.peerResults[0]!.stderr).toContain(`PEER_DEP`)
	} finally {
		await project.cleanup()
	}
}, 30000)
