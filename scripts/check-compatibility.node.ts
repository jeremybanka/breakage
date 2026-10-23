import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { appendFile } from "node:fs/promises"

import type { BreakageBaseline, BreakageOutcome } from "breakage-supervisor"
import { breakage, breakagePrelude } from "breakage-supervisor"

import { changesetsRelease } from "../packages/breakage/src/changesets.ts"
import {
	semverPolicy,
	versionDelta,
	type VersionDelta,
} from "../packages/breakage/src/release.ts"
import manifest from "../packages/breakage/package.json" with { type: "json" }
import configuration from "../breakage.config.ts"

// These releases predate the consumer suite. Never allow arbitrary missing tests.
const bootstrapReleases = new Map([
	[`refs/tags/breakage@0.8.1`, `a6b9449ba0c3a8b5ed2d0130f1f4631970a0c4ad`],
	[`refs/tags/breakage@0.8.2`, `2a10500392ab9a208822e480e2453a79625b29ad`],
	[`refs/tags/breakage@0.8.3`, `6432b0ff5e974e226e7cb60c3288e9471078d240`],
])

export function compatibilityResult(
	baseline: Pick<BreakageBaseline, "ref" | "commit">,
	outcome: BreakageOutcome & { summary: string },
	release?: VersionDelta,
): { message: string; exitCode: number; bootstrap: boolean } {
	if (`breakingChangesFound` in outcome) {
		const allowed = outcome.breakingChangesFound && release?.breaking
		return {
			message: allowed
				? `Breaking changes are covered by release ${release.previousVersion} → ${release.version}. Historical compatibility was NOT established.`
				: outcome.summary,
			exitCode: !outcome.breakingChangesFound || allowed ? 0 : 1,
			bootstrap: false,
		}
	}
	if (
		outcome.gitWasClean &&
		outcome.lastReleaseFound &&
		!outcome.testsWereFound &&
		outcome.summary ===
			`No tests were found matching the pattern "${configuration.testPattern}".` &&
		bootstrapReleases.get(baseline.ref) === baseline.commit
	) {
		return {
			message: `BOOTSTRAP ONLY: ${baseline.ref} predates the public consumer contracts. Historical compatibility was NOT established. Publish a release containing packages/breakage/tests/public; subsequent releases are required to contain the suite.`,
			exitCode: 0,
			bootstrap: true,
		}
	}
	return {
		message: `Compatibility check was inconclusive: ${outcome.summary}`,
		exitCode: 2,
		bootstrap: false,
	}
}

if (import.meta.main) {
	const baselineFile = `.breakage/baseline.json`
	const baseline = await breakagePrelude({
		tagPattern: configuration.tagPattern,
		out: baselineFile,
	})
	console.log(`Pinned supervisor: breakage@0.8.2`)
	console.log(`Release baseline: ${baseline.ref} (${baseline.commit})`)
	const packageDirectory = fileURLToPath(
		new URL(`../packages/breakage`, import.meta.url),
	)
	const previous = JSON.parse(
		execFileSync(
			`git`,
			[`show`, `${baseline.commit}:packages/breakage/package.json`],
			{ encoding: `utf8` },
		),
	) as { name: string; version: string }
	if (previous.name !== manifest.name || typeof previous.version !== `string`)
		throw new Error(`Baseline package identity or version is invalid.`)
	const version = await changesetsRelease()({
		packageName: manifest.name,
		packageDirectory,
		currentVersion: manifest.version,
		baseline: {
			version: previous.version,
			ref: baseline.ref,
			commit: baseline.commit,
		},
	})
	const release = versionDelta(
		previous.version,
		version,
		semverPolicy({ beforeV1: `minor` }),
	)
	console.log(
		`Release intent: ${release.previousVersion} → ${release.version} (${release.delta})`,
	)
	// The frozen supervisor predates the release model. Keep its hook disabled;
	// only the explicit version delta above can acknowledge intentional breaks.
	const outcome = await breakage({
		...configuration,
		baselineFile,
		certifyCommand: `false`,
	})
	const result = compatibilityResult(baseline, outcome, release)
	if (`breakingChangesFound` in outcome && outcome.breakingChangesFound) {
		console.error(outcome.testResult)
	}
	if (result.bootstrap) {
		console.log(
			`::notice title=Compatibility baseline bootstrap::${result.message}`,
		)
	}
	console.log(result.message)
	if (process.env.GITHUB_STEP_SUMMARY) {
		await appendFile(
			process.env.GITHUB_STEP_SUMMARY,
			`Supervisor: breakage@0.8.2\n\nBaseline: ${baseline.ref} (${baseline.commit})\n\n${result.message}\n`,
		)
	}
	process.exitCode = result.exitCode
}
