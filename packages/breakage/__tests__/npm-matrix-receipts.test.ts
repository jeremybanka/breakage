import { expect, it } from "bun:test"
import {
	npmMatrix,
	verifyNpmReceipts,
	type NpmPlan,
	type NpmReceipt,
} from "../src/breakage.ts"
import { planDigest } from "../src/npm/matrix-model.ts"

function fixture(): { plan: NpmPlan; receipts: NpmReceipt[] } {
	const environments = [`react18`, `react19`].map((id, index) => ({
		id,
		label: id,
		packageName: `@atom.io/react`,
		representative: `peer-environments/${id}`,
		suites: [`atom.io`, `react`],
		peers: {
			"atom.io": { version: `0.54.0`, source: `candidate` as const },
			react: { version: `${18 + index}.0.0`, source: `installed` as const },
		},
	}))
	const plan: NpmPlan = {
		formatVersion: 1,
		id: ``,
		runId: `this-run`,
		commit: `a`.repeat(40),
		configs: [`packages/*/breakage.config.ts`],
		environments,
		archives: [
			{
				path: `packages/react/.breakage/package.tgz`,
				sha256: `b`.repeat(64),
				file: `archives/${`b`.repeat(64)}.tgz`,
			},
		],
		packages: [
			{
				config: `packages/react/breakage.config.ts`,
				directory: `packages/react`,
				name: `@atom.io/react`,
				configDigest: `config`,
				inputDigest: `inputs`,
				releases: [],
				audit: {
					package: { name: `@atom.io/react`, version: `0.1.0` },
					mode: `coverage-only`,
					exitCode: 0,
					errors: [],
					support: { status: `first-release`, changes: [] },
					coverage: environments.map((env, index) => ({
						peer: `react`,
						era: `^${18 + index}`,
						representatives: [env.representative],
					})),
					representatives: environments.map((env) => ({
						path: env.representative,
						status: `audited`,
						warnings: [],
						peers: Object.fromEntries(
							Object.entries(env.peers).map(([name, peer]) => [
								name,
								{ ...peer, path: `/planning/${name}` },
							]),
						),
						suites: env.suites.map((peer) => ({ peer, status: `not-run` })),
					})),
				},
			},
		],
	}
	seal(plan)
	const receipts: NpmReceipt[] = environments.map((env) => {
		const report = structuredClone(plan.packages[0]!.audit)
		report.mode = `test`
		report.support = { status: `not-checked`, changes: [] }
		for (const result of report.representatives) {
			const selected = result.path === env.representative
			result.status = selected ? `passed` : `skipped`
			result.suites = selected
				? result.suites.map(({ peer }) => ({ peer, status: `passed` }))
				: []
			for (const peer of Object.values(result.peers))
				peer.path = `/different-runner/${peer.version}`
		}
		return {
			formatVersion: 1,
			id: env.id,
			planId: plan.id,
			exitCode: 0,
			report,
		}
	})
	return { plan, receipts }
}
function seal(plan: NpmPlan): void {
	const { id: _id, ...payload } = plan
	plan.id = planDigest(payload)
}

it(`accepts complete receipts in any order across runner installation paths`, () => {
	const { plan, receipts } = fixture()
	expect(verifyNpmReceipts(plan, receipts.reverse())).toEqual({
		exitCode: 0,
		errors: [],
		environments: 2,
	})
	expect(npmMatrix(JSON.parse(JSON.stringify(plan))).include).toEqual(
		plan.environments.map(({ id, label, packageName, representative }) => ({
			id,
			label,
			packageName,
			representative,
		})),
	)
})

// Ported from atom.io's receipt contracts, with versioned-plan identity replacing
// separate receipt commit/archive fields and additional malformed-input cases.
const invalidReceipts: [string, (receipts: NpmReceipt[]) => void, string][] = [
	[
		`missing environment`,
		(r) => {
			r.pop()
		},
		`receipts`,
	],
	[
		`duplicate replacing missing environment`,
		(r) => {
			r[1] = structuredClone(r[0]!)
		},
		`receipts`,
	],
	[
		`unexpected environment`,
		(r) => {
			r[0]!.id = `unknown`
		},
		`receipts`,
	],
	[
		`stale plan`,
		(r) => {
			r[0]!.planId = `old-plan`
		},
		`different plan`,
	],
	[
		`wrong package`,
		(r) => {
			r[0]!.report!.package.name = `another-package`
		},
		`package identity`,
	],
	[
		`wrong package version`,
		(r) => {
			r[0]!.report!.package.version = `0.2.0`
		},
		`package identity`,
	],
	[
		`audit substituted for execution`,
		(r) => {
			r[0]!.report!.mode = `coverage-only`
		},
		`execution report`,
	],
	[
		`failed environment`,
		(r) => {
			r[0]!.report!.exitCode = 1
		},
		`execution report`,
	],
	[
		`failed receipt`,
		(r) => {
			r[0]!.exitCode = 2
		},
		`execution failed`,
	],
	[
		`receipt without report`,
		(r) => {
			delete r[0]!.report
		},
		`execution failed`,
	],
	[
		`receipt error despite zero exit code`,
		(r) => {
			r[0]!.error = `interrupted`
		},
		`interrupted`,
	],
	[
		`report errors despite zero exit code`,
		(r) => {
			r[0]!.report!.errors.push(`broken`)
		},
		`execution report`,
	],
	[
		`skipped environment`,
		(r) => {
			r[0]!.report!.representatives[0]!.status = `skipped`
		},
		`execute successfully`,
	],
	[
		`omitted selected environment`,
		(r) => {
			r[0]!.report!.representatives.shift()
		},
		`representatives`,
	],
	[
		`unexpected execution`,
		(r) => {
			r[0]!.report!.representatives[1]!.status = `passed`
		},
		`Unexpected execution`,
	],
	[
		`missing suite`,
		(r) => {
			r[0]!.report!.representatives[0]!.suites.pop()
		},
		`relationship suites`,
	],
	[
		`duplicate suite`,
		(r) => {
			const suites = r[0]!.report!.representatives[0]!.suites
			suites[1] = structuredClone(suites[0]!)
		},
		`relationship suites`,
	],
	[
		`extra suite`,
		(r) => {
			r[0]!.report!.representatives[0]!.suites.push({
				peer: `unknown`,
				status: `passed`,
			})
		},
		`relationship suites`,
	],
	[
		`unexecuted suite`,
		(r) => {
			r[0]!.report!.representatives[0]!.suites[0]!.status = `not-run`
		},
		`Suite did not pass`,
	],
	[
		`failed suite despite zero exit code`,
		(r) => {
			r[0]!.report!.representatives[0]!.suites[0]!.status = `compatibility-failure`
		},
		`Suite did not pass`,
	],
	[
		`wrong installed peer`,
		(r) => {
			r[0]!.report!.representatives[0]!.peers.react!.version = `20.0.0`
		},
		`peer identities`,
	],
	[
		`wrong peer source`,
		(r) => {
			r[0]!.report!.representatives[0]!.peers.react!.source = `candidate`
		},
		`peer identities`,
	],
	[
		`malformed report`,
		(r) => {
			Object.assign(r[0]!, { report: {} })
		},
		`Malformed receipt`,
	],
	[
		`unsupported format`,
		(r) => {
			Object.assign(r[0]!, { formatVersion: 2 })
		},
		`Malformed receipt`,
	],
]
for (const [name, mutate, message] of invalidReceipts) {
	it(`rejects ${name}`, () => {
		const { plan, receipts } = fixture()
		mutate(receipts)
		const result = verifyNpmReceipts(plan, receipts)
		expect(result.exitCode).toBe(2)
		expect(result.errors.join(`\n`)).toContain(message)
	})
}
for (const [name, mutate, message] of [
	[
		`uncovered era`,
		(p: NpmPlan) => {
			p.packages[0]!.audit.coverage[0]!.representatives = []
		},
		`Uncovered`,
	],
	[
		`omitted audit environment`,
		(p: NpmPlan) => {
			p.packages[0]!.audit.representatives.pop()
		},
		`audited environments`,
	],
	[
		`unapproved support change`,
		(p: NpmPlan) => {
			p.packages[0]!.audit.support.status = `end-of-support`
		},
		`Support audit`,
	],
	[
		`failed coverage audit`,
		(p: NpmPlan) => {
			p.packages[0]!.audit.exitCode = 2
		},
		`Coverage audit`,
	],
	[
		`empty matrix`,
		(p: NpmPlan) => {
			p.environments = []
		},
		`must contain`,
	],
	[
		`duplicate representative paths`,
		(p: NpmPlan) => {
			p.environments[1]!.representative = p.environments[0]!.representative
		},
		`Duplicate representative`,
	],
	[
		`duplicate package`,
		(p: NpmPlan) => {
			p.packages.push(structuredClone(p.packages[0]!))
		},
		`Duplicate package`,
	],
	[
		`missing archive`,
		(p: NpmPlan) => {
			p.archives = []
		},
		`must contain`,
	],
] as const) {
	it(`rejects plans with ${name}`, () => {
		const { plan, receipts } = fixture()
		mutate(plan)
		seal(plan)
		expect(verifyNpmReceipts(plan, receipts).errors.join(`\n`)).toContain(
			message,
		)
	})
}
for (const field of [`commit`, `runId`, `configDigest`, `sha256`] as const) {
	it(`binds receipts to ${field}, including another run at the same commit`, () => {
		const { plan, receipts } = fixture()
		if (field === `configDigest`) plan.packages[0]!.configDigest = `changed`
		else if (field === `sha256`) {
			plan.archives[0]!.sha256 = `c`.repeat(64)
			plan.archives[0]!.file = `archives/${`c`.repeat(64)}.tgz`
		} else plan[field] = `d`.repeat(40)
		expect(verifyNpmReceipts(plan, receipts).errors.join()).toContain(`digest`)
		seal(plan)
		expect(verifyNpmReceipts(plan, receipts).errors.join()).toContain(
			`different plan`,
		)
	})
}
