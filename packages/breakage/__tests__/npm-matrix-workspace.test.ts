import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { expect, it } from "bun:test"
import {
	npmPlan,
	npmExecute,
	npmVerify,
	npmTest,
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
		const origin = path.join(workspace, `.git`, `test-origin.git`)
		git(workspace, `init`, `--bare`, origin)
		git(workspace, `remote`, `add`, `origin`, origin)
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

it.each([false, true])(
	`executes only audited suites when an unsupported peer's suite would fail: %s`,
	async (unsupportedFails) => {
		const f = npmFixture(
			new URL(`./fixtures/npm/coupled-peers/`, import.meta.url),
		)
		try {
			f.update(`renderer/package.json`, { version: `20.0.0` })
			f.copy(`renderer/src/unsupported.ts`, `renderer/src/index.ts`)
			const archive = f.build(`renderer`)
			f.copy(`peer-environments/one`, `peer-environments/mixed`)
			const filename = `peer-environments/mixed/package.json`
			const manifest = JSON.parse(f.read(filename))
			manifest.dependencies[`coupled-renderer`] = `20.0.0`
			f.write(filename, manifest)
			const lockfile = `peer-environments/mixed/package-lock.json`
			const lock = JSON.parse(f.read(lockfile))
			lock.packages[``].dependencies[`coupled-renderer`] = `20.0.0`
			Object.assign(lock.packages[`node_modules/coupled-renderer`], {
				version: `20.0.0`,
				resolved: `file:../../${archive}`,
			})
			f.write(lockfile, lock)
			f.config.localPeers![`coupled-renderer`] = {
				directory: `renderer`,
				artifact: archive,
			}
			f.config.suites[`coupled-renderer`]!.files = [`contracts/renderer*.ts`]
			f.config.suites[`coupled-renderer`]!.command = unsupportedFails
				? `node contracts/renderer-record.ts && node contracts/renderer.ts`
				: `node contracts/renderer-record.ts && node contracts/renderer-compatible.ts`
			f.copy(
				new URL(`../tests/public/fixtures/npm/data.config.ts`, import.meta.url),
				`breakage.config.ts`,
			)
			f.write(`fixture-config.json`, { npm: f.config })
			git(f.directory, `add`, `.`)
			git(
				f.directory,
				`commit`,
				`-m`,
				`Mixed support in a complete peer matrix`,
			)
			const location = { rootDirectory: f.directory }
			const plan = await npmPlan(
				{ configs: `breakage.config.ts`, prepare: () => {} },
				location,
			)
			const mixed = plan.environments.find(
				(e) => e.representative === `peer-environments/mixed`,
			)!
			expect(mixed.suites).toEqual([`coupled-host`])
			const receipts: NpmReceipt[] = []
			for (const env of plan.environments) {
				const receipt = await npmExecute(plan, env.id, location)
				expect(receipt.exitCode, JSON.stringify(receipt)).toBe(0)
				const result = receipt.report!.representatives.find(
					(r) => r.path === env.representative,
				)!
				expect(result.suites.map((s) => s.peer).sort()).toEqual(env.suites)
				if (env.id === mixed.id)
					expect(result.peers[`coupled-renderer`]).toMatchObject({
						version: `20.0.0`,
						source: `installed`,
					})
				receipts.push(receipt)
			}
			expect(f.read(`.breakage/renderer-runs`)).toBe(`one\n`)
			expect(await npmVerify(plan, receipts, location)).toEqual({
				exitCode: 0,
				environments: 2,
				errors: [],
			})
			// Explicit exploration keeps its existing all-present-suites behavior.
			const focused = await npmTest(
				f.config,
				{ representative: mixed.representative },
				{ baseDirectory: f.directory },
			)
			expect(focused.exitCode, JSON.stringify(focused)).toBe(
				unsupportedFails ? 1 : 0,
			)
			expect(f.read(`.breakage/renderer-runs`)).toBe(`one\nmixed\n`)
			expect(
				focused.representatives.find((r) => r.path === mixed.representative)!
					.suites,
			).toHaveLength(2)
		} finally {
			f.clean()
		}
	},
	45_000,
)
