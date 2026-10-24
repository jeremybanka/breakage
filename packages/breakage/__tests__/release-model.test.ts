import { rejects } from "node:assert/strict"
import { expect, it } from "bun:test"
import {
	defineConfig,
	resolveReleaseDelta,
	semverPolicy,
	versionDelta,
	versionTransition,
	type ReleaseConfig,
	type VersionTransition,
} from "breakage"

const context = {
	packageName: `example`,
	packageDirectory: process.cwd(),
	currentVersion: `0.8.5`,
	baseline: {
		version: `0.8.4`,
		ref: `refs/tags/example@0.8.4`,
		commit: `pinned`,
	},
}

it(`keeps transition evidence separate from release policy`, async () => {
	const transition = versionTransition(`0.8.4`, `0.9.0`)
	const resolveDelta = async () => ({ ...transition, breaking: true })
	let calls = 0
	const policy = (evidence: VersionTransition): boolean => {
		calls++
		expect(evidence).toEqual(transition)
		expect(evidence).not.toHaveProperty(`breaking`)
		return false
	}
	const evidence = await resolveReleaseDelta({ resolveDelta, policy }, context)
	expect(evidence).toEqual(transition)
	expect(calls).toBe(0)
	expect(
		versionDelta(evidence!.previousVersion, evidence!.version, policy).breaking,
	).toBe(false)
	expect(calls).toBe(1)
	expect(
		versionDelta(
			evidence!.previousVersion,
			evidence!.version,
			semverPolicy({ beforeV1: `minor` }),
		).breaking,
	).toBe(true)
})

it(`defaults to the pinned baseline and current manifest; absent baseline uses the current version`, async () => {
	expect(await resolveReleaseDelta({}, context)).toEqual(
		versionTransition(`0.8.4`, `0.8.5`),
	)
	const { baseline: _baseline, ...candidate } = context
	expect(await resolveReleaseDelta({}, candidate)).toEqual(
		versionTransition(`0.8.5`, `0.8.5`),
	)
	expect(
		await resolveReleaseDelta({ resolveDelta: () => undefined }, context),
	).toBeUndefined()
})

it.each([
	`0.9.0`,
	null,
	[],
	{ previousVersion: `invalid`, version: `0.9.0`, delta: `minor` },
	{ previousVersion: `0.8.4`, version: `latest`, delta: `minor` },
	{ previousVersion: `0.8.4`, version: `0.8.3`, delta: `patch` },
	{ previousVersion: `0.8.4`, version: `0.9.0` },
	{ previousVersion: `0.8.4`, version: `0.9.0`, delta: `major` },
	{ previousVersion: `0.1.0`, version: `0.9.0`, delta: `minor` },
])(`rejects malformed or mismatched transition evidence: %j`, async (value) => {
	const config = { resolveDelta: () => value } as unknown as ReleaseConfig
	await rejects(resolveReleaseDelta(config, context))
})

it(`propagates resolver errors and rejects obsolete version hooks`, async () => {
	await rejects(
		resolveReleaseDelta(
			{
				resolveDelta: () => {
					throw new Error(`plan unavailable`)
				},
			},
			context,
		),
		/plan unavailable/,
	)
	expect(() =>
		defineConfig({
			release: { version: () => `0.9.0` },
		} as unknown as Parameters<typeof defineConfig>[0]),
	).toThrow(`release.version was removed`)
})

it(`does not consult policy for equal or older transitions`, () => {
	const policy = (): boolean => {
		throw new Error(`must not be called`)
	}
	for (const next of [`1.0.0`, `0.9.0`])
		expect(versionDelta(`1.0.0`, next, policy).breaking).toBe(false)
	expect(() =>
		versionDelta(`1.0.0`, `2.0.0`, (() => `yes`) as unknown as () => boolean),
	).toThrow(`Release policy must return a boolean`)
})
