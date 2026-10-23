import type { ReleaseConfig, VersionDelta } from "../release.ts"

export type SupportChange = {
	peer: string
	reason: `narrowed-range` | `required-peer`
	previous: string | null
	current: string | null
}

export type NpmSuite = {
	/** Package-relative globs; preserve relative paths inside the stage. */
	files: string[]
	/** Run once; 1 means assertion failure, other nonzero codes mean setup failure. */
	command: string
}

export type NpmConfig = {
	release?: ReleaseConfig
	packageDirectory?: string
	artifact: string
	representatives: string | string[]
	lockfile: string
	prepareCommand: string
	installCommand?: string
	suites: Record<string, NpmSuite>
	/** Currently declared local peers must support and exercise each planned release. */
	localPeers?: Record<string, { directory: string; artifact: string }>
	baseline:
		| { firstRelease: true }
		| { tagPattern?: string; baselineFile?: string }
}

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
