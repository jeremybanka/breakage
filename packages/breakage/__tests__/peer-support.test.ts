import { expect, it } from "bun:test"

import { breakage } from "../src/breakage.ts"
import { peerProject } from "./peer-project.ts"

it.each([false, true])(
	`requires certification when a declared peer range narrows (certified: %s)`,
	async (certified) => {
		const project = await peerProject({
			cases: [{ name: `retained`, peers: { host: `1.0.0` } }],
		})
		try {
			await project.write(
				`package.json`,
				JSON.stringify({
					name: `fixture-plugin`,
					version: `2.0.0`,
					peerDependencies: { host: `>=1.0.0 <1.1.0` },
				}),
			)
			await project.git.add(`.`).commit(`Drop later host releases`)
			const result = await breakage({
				...project.options,
				certifyCommand: certified ? `printf acknowledged` : `false`,
			})
			expect(result).toMatchObject({
				success: certified,
				supportCertified: certified,
				supportChanges: [
					{ peer: `host`, released: `^1.0.0`, proposed: `>=1.0.0 <1.1.0` },
				],
				peerResults: [{ status: `passed`, contract: `released` }],
			})
		} finally {
			await project.cleanup()
		}
	},
)

it(`uses current integration contracts for newly added peer support`, async () => {
	const project = await peerProject({
		cases: [
			{ name: `retained`, peers: { host: `1.0.0` } },
			{ name: `added`, peers: { host: `2.0.0` } },
		],
	})
	try {
		await project.write(
			`package.json`,
			JSON.stringify({
				name: `fixture-plugin`,
				version: `1.1.0`,
				peerDependencies: { host: `^1.0.0 || ^2.0.0` },
			}),
		)
		await project.write(
			`public/contract.ts`,
			`import assert from "node:assert/strict"; assert.equal(JSON.parse(process.env.BREAKAGE_PEERS).host, "2.0.0");`,
		)
		await project.git.add(`.`).commit(`Support a new host major`)
		expect(await breakage(project.options)).toMatchObject({
			success: true,
			supportChanges: [],
			peerResults: [
				{ contract: `released`, status: `passed` },
				{ contract: `current`, status: `passed` },
			],
		})
	} finally {
		await project.cleanup()
	}
})

it(`never certifies a failing retained combination even when support was dropped elsewhere`, async () => {
	const project = await peerProject({
		cases: [{ name: `retained`, peers: { host: `1.1.0` } }],
	})
	try {
		await project.write(
			`package.json`,
			JSON.stringify({
				name: `fixture-plugin`,
				version: `2.0.0`,
				peerDependencies: { host: `^1.1.0` },
			}),
		)
		await project.git.add(`.`).commit(`Drop minimum support and bump major`)
		expect(await breakage(project.options)).toMatchObject({
			success: false,
			supportCertified: true,
			peerResults: [{ contract: `released`, status: `contract-failed` }],
		})
	} finally {
		await project.cleanup()
	}
})
