// cspell:words premajor preminor prepatch
import { createHash } from "node:crypto"
import { type } from "arktype"
import type { NpmPeerEvidence, NpmReport } from "./types.ts"

export type NpmArchiveRequest = {
	packageName: string
	directory: string
	artifact: string
}
export type NpmPrepareContext = {
	rootDirectory: string
	archives: NpmArchiveRequest[]
}
export type NpmMatrixLabelContext = {
	packageName: string
	representative: string
	description?: string
	peers: Record<string, NpmPeerEvidence>
}
export const npmMatrixConfigSchema = type({
	"+": `reject`,
	configs: `string | string[]`,
	prepare: type(`string`).or(
		type(`Function`).as<(context: NpmPrepareContext) => void | Promise<void>>(),
	),
	"label?": type(`Function`).as<(context: NpmMatrixLabelContext) => string>(),
})
export type NpmMatrixConfig = typeof npmMatrixConfigSchema.infer

const transition = type({
	previousVersion: `string`,
	version: `string`,
	delta: `'major' | 'premajor' | 'minor' | 'preminor' | 'patch' | 'prepatch' | 'prerelease' | 'release' | 'none'`,
})
const identity = type({
	version: `string`,
	source: `'installed' | 'candidate'`,
})
const reportSchema = type({
	package: { name: `string`, version: `string` },
	mode: `'check' | 'test' | 'coverage-only'`,
	exitCode: `0 | 1 | 2`,
	errors: `string[]`,
	coverage: type({
		peer: `string`,
		era: `string`,
		representatives: `string[]`,
	}).array(),
	support: {
		status: `'unchanged' | 'breaking-release' | 'end-of-support' | 'first-release' | 'not-checked' | 'setup-error'`,
		changes: type({
			peer: `string`,
			reason: `'narrowed-range' | 'required-peer'`,
			previous: `string | null`,
			current: `string | null`,
		}).array(),
		"previousVersion?": `string`,
		"release?": transition.and({ breaking: `boolean` }),
		"error?": `string`,
	},
	representatives: type({
		path: `string`,
		status: `'passed' | 'audited' | 'skipped' | 'compatibility-failure' | 'setup-error'`,
		peers: {
			"[string]": identity.and({ path: `string`, "archiveVersion?": `string` }),
		},
		suites: type({
			peer: `string`,
			status: `'passed' | 'compatibility-failure' | 'setup-error' | 'not-run'`,
			"output?": `string`,
		}).array(),
		warnings: `string[]`,
		"error?": `string`,
	}).array(),
}).as<NpmReport>()

export const npmPlanSchema = type({
	"+": `reject`,
	formatVersion: `1`,
	id: `string`,
	runId: `string`,
	commit: `string`,
	configs: `string[]`,
	packages: type({
		config: `string`,
		directory: `string`,
		name: `string`,
		configDigest: `string`,
		inputDigest: `string`,
		audit: reportSchema,
		releases: type({
			context: {
				packageName: `string`,
				packageDirectory: `string`,
				currentVersion: `string`,
				"baseline?": {
					version: `string`,
					"ref?": `string`,
					"commit?": `string`,
				},
			},
			"transition?": transition,
		}).array(),
	}).array(),
	environments: type({
		id: `string`,
		label: `string`,
		packageName: `string`,
		representative: `string`,
		suites: `string[]`,
		peers: { "[string]": identity },
	}).array(),
	archives: type({ path: `string`, file: `string`, sha256: `string` }).array(),
})
export type NpmPlan = typeof npmPlanSchema.infer
export const npmReceiptSchema = type({
	"+": `reject`,
	formatVersion: `1`,
	planId: `string`,
	id: `string`,
	exitCode: `0 | 1 | 2`,
	"report?": reportSchema,
	"error?": `string`,
})
export type NpmReceipt = typeof npmReceiptSchema.infer
export type NpmVerification = {
	exitCode: 0 | 1 | 2
	errors: string[]
	environments: number
}

/** Stable object ordering; arrays retain their semantic order. */
export function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(`,`)}]`
	if (value && typeof value === `object`)
		return `{${Object.entries(value)
			.filter(([, v]) => v !== undefined)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
			.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
			.join(`,`)}}`
	return JSON.stringify(value) ?? `undefined`
}
export function digest(value: string | Uint8Array): string {
	return createHash(`sha256`).update(value).digest(`hex`)
}
export function planDigest(plan: Omit<NpmPlan, `id`>): string {
	return digest(canonical(plan))
}
export function peerIdentities(
	peers: Record<string, NpmPeerEvidence>,
): Record<string, { version: string; source: `installed` | `candidate` }> {
	return Object.fromEntries(
		Object.entries(peers).map(([name, { version, source }]) => [
			name,
			{ version, source },
		]),
	)
}
export function requireMatrix(
	condition: unknown,
	message: string,
): asserts condition {
	if (!condition) throw new Error(message)
}
function sameNames(
	actual: string[],
	expected: string[],
	message: string,
): void {
	const counts = (names: string[]): Map<string, number> => {
		const result = new Map<string, number>()
		for (const name of names) result.set(name, (result.get(name) ?? 0) + 1)
		return result
	}
	const actualCounts = counts(actual)
	const expectedCounts = counts(expected)
	const missing = [...expectedCounts]
		.filter(([name, count]) => (actualCounts.get(name) ?? 0) < count)
		.map(([name]) => name)
	const extra = [...actualCounts]
		.filter(([name, count]) => count > (expectedCounts.get(name) ?? 0))
		.map(([name]) => name)
	requireMatrix(
		!missing.length && !extra.length,
		`${message}${missing.length ? ` Missing: ${missing.join(`, `)}.` : ``}${extra.length ? ` Unexpected or duplicated: ${extra.join(`, `)}.` : ``}`,
	)
}

/** Validate the audit as well as the plan envelope; empty or partial plans never pass. */
export function validateNpmPlan(value: unknown): NpmPlan {
	const plan = npmPlanSchema.assert(value)
	const { id, ...payload } = plan
	requireMatrix(
		id === planDigest(payload),
		`Plan digest does not match its contents.`,
	)
	requireMatrix(
		plan.runId.length > 0 && /^[a-f0-9]{40,64}$/.test(plan.commit),
		`Invalid plan source identity.`,
	)
	requireMatrix(
		plan.configs.length &&
			plan.packages.length &&
			plan.environments.length &&
			plan.archives.length,
		`Plan must contain packages, environments, and archives.`,
	)
	for (const [name, values] of [
		[`package`, plan.packages.map((p) => p.name)],
		[`configuration`, plan.packages.map((p) => p.config)],
		[`environment`, plan.environments.map((e) => e.id)],
		[`archive`, plan.archives.map((a) => a.path)],
	] as const)
		requireMatrix(
			new Set(values).size === values.length,
			`Duplicate ${name} identities in plan.`,
		)
	for (const archive of plan.archives)
		requireMatrix(
			/^[a-f0-9]{64}$/.test(archive.sha256) &&
				archive.file === `archives/${archive.sha256}.tgz`,
			`Invalid archive digest or bundle path: ${archive.path}.`,
		)
	sameNames(
		[...new Set(plan.environments.map((e) => e.packageName))],
		plan.packages.map((p) => p.name),
		`Plan environments do not match package audits.`,
	)
	for (const pkg of plan.packages) {
		const audit = pkg.audit
		requireMatrix(
			audit.package.name === pkg.name &&
				audit.mode === `coverage-only` &&
				audit.exitCode === 0 &&
				audit.errors.length === 0 &&
				!audit.support.error,
			`Coverage audit failed for ${pkg.name}.`,
		)
		requireMatrix(
			[`unchanged`, `breaking-release`, `first-release`].includes(
				audit.support.status,
			),
			`Support audit did not pass for ${pkg.name}.`,
		)
		requireMatrix(
			audit.coverage.length &&
				audit.coverage.every((c) => c.representatives.length),
			`Uncovered peer era for ${pkg.name}.`,
		)
		const expected = plan.environments.filter((e) => e.packageName === pkg.name)
		requireMatrix(
			new Set(expected.map((e) => e.representative)).size === expected.length,
			`Duplicate representative paths for ${pkg.name}.`,
		)
		sameNames(
			audit.representatives.map((r) => r.path),
			expected.map((e) => e.representative),
			`Missing or duplicate audited environments for ${pkg.name}.`,
		)
		for (const env of expected) {
			const result = audit.representatives.find(
				(r) => r.path === env.representative,
			)!
			requireMatrix(
				result.status === `audited` && !result.error && env.suites.length,
				`Environment was not audited: ${pkg.name} / ${env.representative}.`,
			)
			sameNames(
				result.suites.map((s) => s.peer),
				env.suites,
				`Audited suites differ: ${env.id}.`,
			)
			requireMatrix(
				new Set(env.suites).size === env.suites.length &&
					result.suites.every((s) => s.status === `not-run`),
				`Invalid audited suites: ${env.id}.`,
			)
			requireMatrix(
				canonical(peerIdentities(result.peers)) === canonical(env.peers),
				`Audited peer identities differ: ${env.id}.`,
			)
		}
		for (const coverage of audit.coverage)
			for (const name of coverage.representatives)
				requireMatrix(
					expected.some(
						(e) =>
							e.representative === name && e.suites.includes(coverage.peer),
					),
					`Coverage references an unplanned suite: ${pkg.name} / ${name} / ${coverage.peer}.`,
				)
	}
	return plan
}

/** Pure receipt verification; runner-local installation paths are diagnostic only. */
export function verifyNpmReceipts(
	value: unknown,
	receipts: readonly unknown[],
): NpmVerification {
	const errors: string[] = []
	let environments = 0
	try {
		const plan = validateNpmPlan(value)
		environments = plan.environments.length
		const parsed = receipts.map((r, i) => {
			try {
				return npmReceiptSchema.assert(r)
			} catch (cause) {
				throw new Error(
					`Malformed receipt ${i + 1}: ${cause instanceof Error ? cause.message : String(cause)}`,
					{ cause },
				)
			}
		})
		const environmentName = (id: string): string => {
			const env = plan.environments.find((e) => e.id === id)
			return env ? `${env.packageName} / ${env.representative} (${id})` : id
		}
		sameNames(
			parsed.map((r) => environmentName(r.id)),
			plan.environments.map((e) => environmentName(e.id)),
			`Missing, duplicate, or unexpected environment receipts.`,
		)
		for (const env of plan.environments) {
			try {
				const receipt = parsed.find((r) => r.id === env.id)!
				requireMatrix(
					receipt.planId === plan.id,
					`Receipt belongs to a different plan.`,
				)
				requireMatrix(
					receipt.exitCode === 0 && !receipt.error && receipt.report,
					receipt.error ?? `Environment execution failed.`,
				)
				const report = receipt.report
				const pkg = plan.packages.find((p) => p.name === env.packageName)!
				requireMatrix(
					canonical(report.package) === canonical(pkg.audit.package),
					`Wrong package identity.`,
				)
				requireMatrix(
					report.mode === `test` &&
						report.exitCode === 0 &&
						report.errors.length === 0 &&
						report.support.status === `not-checked` &&
						!report.support.error,
					`Receipt does not contain a successful execution report.`,
				)
				sameNames(
					report.representatives.map((r) => r.path),
					pkg.audit.representatives.map((r) => r.path),
					`Missing or duplicate representatives in execution report.`,
				)
				for (const result of report.representatives) {
					if (result.path !== env.representative) {
						requireMatrix(
							result.status === `skipped` &&
								result.suites.length === 0 &&
								!result.error,
							`Unexpected execution: ${result.path}.`,
						)
						continue
					}
					requireMatrix(
						result.status === `passed` && !result.error,
						`Environment did not execute successfully.`,
					)
					sameNames(
						result.suites.map((s) => s.peer),
						env.suites,
						`Missing, duplicate, or unexpected relationship suites.`,
					)
					for (const suite of result.suites)
						requireMatrix(
							suite.status === `passed`,
							`Suite did not pass: ${suite.peer}.`,
						)
					requireMatrix(
						canonical(peerIdentities(result.peers)) === canonical(env.peers),
						`Installed peer identities differ from the audit.`,
					)
				}
			} catch (error) {
				errors.push(
					`${env.packageName} / ${env.representative}: ${error instanceof Error ? error.message : String(error)}`,
				)
			}
		}
	} catch (error) {
		errors.push(error instanceof Error ? error.message : String(error))
	}
	return { exitCode: errors.length ? 2 : 0, errors, environments }
}
