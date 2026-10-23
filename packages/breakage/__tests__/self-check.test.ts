import { expect, it } from "bun:test"

import { versionDelta } from "../src/release.ts"

import configuration from "../../../breakage.config.json" with { type: "json" }
import { compatibilityResult } from "../../../scripts/check-compatibility.node.ts"

const baseline = {
	ref: `refs/tags/breakage@0.8.2`,
	commit: `2a10500392ab9a208822e480e2453a79625b29ad`,
}
const missingTests = {
	gitWasClean: true,
	lastReleaseFound: true,
	lastReleaseTag: baseline.ref,
	testsWereFound: false,
	summary: `No tests were found matching the pattern "${configuration.testPattern}".`,
} as const

it.each([
	{
		ref: `refs/tags/breakage@0.8.1`,
		commit: `a6b9449ba0c3a8b5ed2d0130f1f4631970a0c4ad`,
	},
	baseline,
	{
		ref: `refs/tags/breakage@0.8.3`,
		commit: `6432b0ff5e974e226e7cb60c3288e9471078d240`,
	},
])(
	`labels the known initial baseline as bootstrap, never compatibility: $ref`,
	(release) => {
		const result = compatibilityResult(release, {
			...missingTests,
			lastReleaseTag: release.ref,
		})
		expect(result).toMatchObject({ exitCode: 0, bootstrap: true })
		expect(result.message).toContain(
			`Historical compatibility was NOT established`,
		)
	},
)

it.each([
	{ ref: `refs/tags/breakage@0.8.4`, commit: baseline.commit },
	{ ref: baseline.ref, commit: `0`.repeat(40) },
])(
	`rejects a missing suite for an unknown tag or moved release: $ref`,
	(release) => {
		expect(compatibilityResult(release, missingTests)).toMatchObject({
			exitCode: 2,
			bootstrap: false,
		})
	},
)

it(`does not turn setup failures into bootstrap success`, () => {
	for (const outcome of [
		{ gitWasClean: false, summary: `dirty checkout` } as const,
		{
			gitWasClean: true,
			lastReleaseFound: false,
			summary: `no release`,
		} as const,
		{ ...missingTests, summary: `Failed to list production files.` },
	]) {
		expect(compatibilityResult(baseline, outcome)).toMatchObject({
			exitCode: 2,
			bootstrap: false,
		})
	}
})

it(`enforces a released contract failure even for a bootstrap tag`, () => {
	expect(
		compatibilityResult(baseline, {
			...missingTests,
			testsWereFound: true,
			testsFound: [`contract.test.ts`],
			breakingChangesFound: true,
			breakingChangesCertified: false,
			testResult: `consumer regression`,
			certificationStdout: ``,
			certificationStderr: ``,
			summary: `Breaking changes were found, but not certified.`,
		}),
	).toMatchObject({ exitCode: 1, bootstrap: false })
})

it.each([
	[`0.8.5`, `0.9.0`, 0],
	[`0.8.5`, `0.8.6`, 1],
	[`0.9.0`, `0.9.0`, 1],
] as const)(
	`requires a breaking delta for historical failure: %s → %s`,
	(previous, next, exitCode) => {
		const release = versionDelta(previous, next, { beforeV1: `minor` })
		const result = compatibilityResult(
			baseline,
			{
				...missingTests,
				testsWereFound: true,
				testsFound: [`contract.test.ts`],
				breakingChangesFound: true,
				breakingChangesCertified: false,
				testResult: `consumer regression`,
				certificationStdout: ``,
				certificationStderr: ``,
				summary: `Breaking changes were found, but not certified.`,
			},
			release,
		)
		expect(result).toMatchObject({ exitCode, bootstrap: false })
		if (exitCode === 0)
			expect(result.message).toContain(
				`Historical compatibility was NOT established`,
			)
	},
)

it(`cannot cover inconclusive historical checks with a breaking release`, () => {
	const release = versionDelta(`0.8.5`, `0.9.0`, { beforeV1: `minor` })
	const currentBaseline = {
		ref: `refs/tags/breakage@0.8.5`,
		commit: baseline.commit,
	}
	for (const outcome of [
		missingTests,
		{ gitWasClean: false, summary: `dirty checkout` } as const,
		{
			gitWasClean: true,
			lastReleaseFound: false,
			summary: `no release`,
		} as const,
	])
		expect(
			compatibilityResult(currentBaseline, outcome, release).exitCode,
		).toBe(2)
})
