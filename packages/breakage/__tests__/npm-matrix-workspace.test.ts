import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { expect, it } from "bun:test"
import {
	npmPlan,
	npmExecute,
	npmVerify,
	type NpmReceipt,
} from "../src/breakage.ts"
import { git, npmFixture } from "../tests/public/npm-fixture.ts"

it(`discovers multiple packages and executes all coupled relationship suites from one bundle`, async () => {
	const root = npmFixture()
	const coupled = npmFixture(
		new URL(`./fixtures/npm/coupled-peers/`, import.meta.url),
	)
	const workspace = mkdtempSync(
		path.join(tmpdir(), `breakage-matrix-workspace-`),
	)
	try {
		coupled.config.localPeers = {
			...coupled.config.localPeers,
			integration: {
				directory: `../integration`,
				artifact: `../integration/${root.config.artifact}`,
			},
			removed: {
				directory: `../removed`,
				artifact: `../removed/artifacts/package.tgz`,
			},
		}
		coupled.copy(
			new URL(`../tests/public/fixtures/npm/data.config.ts`, import.meta.url),
			`breakage.config.ts`,
		)
		coupled.write(`fixture-config.json`, { npm: coupled.config })
		cpSync(root.directory, path.join(workspace, `packages/integration`), {
			recursive: true,
			filter: (filename) => path.basename(filename) !== `.git`,
		})
		cpSync(coupled.directory, path.join(workspace, `packages/coupled`), {
			recursive: true,
			filter: (filename) => path.basename(filename) !== `.git`,
		})
		writeFileSync(path.join(workspace, `.gitignore`), `.breakage/\n`)
		git(workspace, `init`, `--initial-branch=main`)
		git(workspace, `config`, `user.name`, `Matrix Tests`)
		git(workspace, `config`, `user.email`, `tests@example.invalid`)
		git(workspace, `add`, `.`)
		git(workspace, `commit`, `-m`, `Workspace with two integration packages`)
		const location = { rootDirectory: workspace }
		let preparations = 0
		const plan = await npmPlan(
			{
				configs: [`packages/*/breakage.config.ts`],
				prepare: ({ archives }) => {
					preparations++
					// Shared archives are requested once; historical-only removed peers need none.
					expect(archives).toHaveLength(4)
					for (const archive of archives)
						expect(existsSync(path.join(workspace, archive.artifact))).toBe(
							true,
						)
				},
			},
			location,
		)
		expect(preparations).toBe(1)
		expect(plan.packages.map((p) => p.name)).toEqual([
			`coupled-integration`,
			`integration`,
		])
		expect(plan.environments).toHaveLength(3)
		const receipts: NpmReceipt[] = []
		for (const environment of plan.environments) {
			const receipt = await npmExecute(plan, environment.id, location)
			expect(receipt.exitCode, JSON.stringify(receipt)).toBe(0)
			receipts.push(receipt)
		}
		const report = receipts.find(
			(r) => r.report?.package.name === `coupled-integration`,
		)!.report!
		expect(report.representatives[0]!.suites.map((s) => s.peer).sort()).toEqual(
			[`coupled-host`, `coupled-renderer`],
		)
		expect(await npmVerify(plan, receipts.reverse(), location)).toEqual({
			exitCode: 0,
			environments: 3,
			errors: [],
		})
	} finally {
		root.clean()
		coupled.clean()
		rmSync(workspace, { recursive: true, force: true })
	}
}, 60_000)
