import type { VersionDelta } from "../release.ts"

export type SupportChange = {
	peer: string
	reason: `narrowed-range` | `required-peer`
	previous: string | null
	current: string | null
}

export type NpmSuite = typeof import("./config.ts").npmSuiteSchema.infer
export type NpmConfig = typeof import("./config.ts").npmConfigSchema.infer

export type NpmTestSelection =
	| { peer: string; range: string }
	| { representative: string }

export type NpmPeerEvidence = {
	version: string
	path: string
	source: `installed` | `candidate`
	archiveVersion?: string
}

export type NpmSuiteResult = {
	peer: string
	status: `passed` | `compatibility-failure` | `setup-error` | `not-run`
	output?: string
}

export type NpmRepresentativeResult = {
	path: string
	status:
		| `passed`
		| `audited`
		| `skipped`
		| `compatibility-failure`
		| `setup-error`
	peers: Record<string, NpmPeerEvidence>
	suites: NpmSuiteResult[]
	warnings: string[]
	error?: string
}

export type NpmReport = {
	package: { name: string; version: string }
	mode: `check` | `coverage-only` | `test`
	exitCode: 0 | 1 | 2
	representatives: NpmRepresentativeResult[]
	coverage: { peer: string; era: string; representatives: string[] }[]
	support: {
		status:
			| `unchanged`
			| `breaking-release`
			| `end-of-support`
			| `first-release`
			| `not-checked`
			| `setup-error`
		changes: SupportChange[]
		previousVersion?: string
		release?: VersionDelta
		error?: string
	}
	errors: string[]
}
