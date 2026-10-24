// cspell:words premajor preminor prepatch
import semver from "semver"
import { type } from "arktype"

export type ReleaseDeltaContext = {
	packageName: string
	packageDirectory: string
	currentVersion: string
	/** The selected historical release, when checking compatibility. */
	baseline?: { version: string; ref?: string; commit?: string }
}
export type VersionTransition = {
	previousVersion: string
	version: string
	delta:
		| `major`
		| `premajor`
		| `minor`
		| `preminor`
		| `patch`
		| `prepatch`
		| `prerelease`
		| `release`
		| `none`
}
export type ReleaseDeltaResolver = (
	context: ReleaseDeltaContext,
) => VersionTransition | undefined | Promise<VersionTransition | undefined>
export type VersionDelta = VersionTransition & { breaking: boolean }
export type SemverPolicyOptions = { beforeV1?: `major` | `minor` | `patch` }
export type ReleasePolicyFunction = (delta: VersionTransition) => boolean
export type ReleasePolicy = ReleasePolicyFunction
export const releaseSchema = type({
	"+": `reject`,
	"resolveDelta?": type(`Function`).as<ReleaseDeltaResolver>(),
	"policy?": type(`Function`).as<ReleasePolicy>(),
})
export type ReleaseConfig = typeof releaseSchema.infer

/** Choose which version increments permit breaking changes. Prerelease-only increments do not. */
export function semverPolicy({
	beforeV1 = `major`,
}: SemverPolicyOptions = {}): ReleasePolicyFunction {
	if (![`major`, `minor`, `patch`].includes(beforeV1))
		throw new Error(`Invalid beforeV1 policy.`)
	return ({ previousVersion, version }) => {
		const previous = new semver.SemVer(previousVersion)
		const next = new semver.SemVer(version)
		if (next.major > previous.major) return true
		if (previous.major !== 0 || beforeV1 === `major`) return false
		return (
			next.minor > previous.minor ||
			(beforeV1 === `patch` && next.patch > previous.patch)
		)
	}
}

/** Describe a version transition without deciding whether it permits breakage. */
export function versionTransition(
	previousVersion: string,
	version: string,
): VersionTransition {
	if (!semver.valid(previousVersion) || !semver.valid(version))
		throw new Error(`Expected exact semantic versions.`)
	return {
		previousVersion,
		version,
		delta: semver.diff(previousVersion, version) ?? `none`,
	}
}

/** Pure comparison; equal and older versions never permit breaking changes. */
export function versionDelta(
	previousVersion: string,
	version: string,
	policy: ReleasePolicy = semverPolicy(),
): VersionDelta {
	const evidence = versionTransition(previousVersion, version)
	const breaking = semver.gt(version, previousVersion)
		? policy(evidence)
		: false
	if (typeof breaking !== `boolean`)
		throw new Error(`Release policy must return a boolean.`)
	return { ...evidence, breaking }
}

export function validateRelease(
	value: unknown,
): asserts value is ReleaseConfig {
	if (typeof value !== `object` || value === null || Array.isArray(value))
		throw new Error(`release must be an object.`)
	if (`version` in value)
		throw new Error(
			`release.version was removed. Use release.resolveDelta to return a version transition.`,
		)
	releaseSchema.assert(value)
}

/** Resolve and validate release evidence; policy is applied separately. */
export async function resolveReleaseDelta(
	config: ReleaseConfig,
	context: ReleaseDeltaContext,
): Promise<VersionTransition | undefined> {
	validateRelease(config)
	const transition = config.resolveDelta
		? await config.resolveDelta(context)
		: versionTransition(
				context.baseline?.version ?? context.currentVersion,
				context.currentVersion,
			)
	if (transition === undefined) return undefined
	if (
		typeof transition !== `object` ||
		transition === null ||
		Array.isArray(transition) ||
		typeof transition.previousVersion !== `string` ||
		!semver.valid(transition.previousVersion) ||
		typeof transition.version !== `string` ||
		!semver.valid(transition.version) ||
		!semver.valid(context.currentVersion) ||
		semver.lt(transition.version, context.currentVersion)
	)
		throw new Error(
			`Invalid release transition for ${context.packageName}; expected exact versions and a current/newer target.`,
		)
	if (
		context.baseline &&
		transition.previousVersion !== context.baseline.version
	)
		throw new Error(
			`Release transition for ${context.packageName} does not match the selected baseline.`,
		)
	const evidence = versionTransition(
		transition.previousVersion,
		transition.version,
	)
	if (transition.delta !== evidence.delta)
		throw new Error(
			`Release transition for ${context.packageName} has an inconsistent semver delta.`,
		)
	// Only evidence crosses this boundary; resolver-supplied policy decisions are ignored.
	return evidence
}

/** Removed hooks must fail explicitly, including in untyped configurations. */
export function rejectCertificationOptions(value: object): void {
	for (const key of [`certifyCommand`, `releaseIntent`, `certifyBreaking`]) {
		if (key in value)
			throw new Error(
				`${key} was removed. Use release.resolveDelta and release.policy instead.`,
			)
	}
}
