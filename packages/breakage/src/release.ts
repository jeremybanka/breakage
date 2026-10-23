import semver from "semver"

export type ReleaseVersionContext = {
	packageName: string
	packageDirectory: string
	currentVersion: string
	baseline?: { version: string; ref?: string; commit?: string }
}
export type ReleaseVersion =
	| string
	| ((
			context: ReleaseVersionContext,
	  ) => string | undefined | Promise<string | undefined>)
export type VersionDelta = {
	previousVersion: string
	version: string
	delta: string
	breaking: boolean
}
export type SemverPolicyOptions = { beforeV1?: `major` | `minor` | `patch` }
export type ReleasePolicyFunction = (
	delta: Omit<VersionDelta, `breaking`>,
) => boolean
export type ReleasePolicy = ReleasePolicyFunction | SemverPolicyOptions
export type ReleaseConfig = {
	/** Defaults to the current package manifest version. */
	version?: ReleaseVersion
	/** Defaults to major releases, including before v1. */
	policy?: ReleasePolicy
}

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

/** Pure comparison; equal and older versions never permit breaking changes. */
export function versionDelta(
	previousVersion: string,
	version: string,
	policy: ReleasePolicy = semverPolicy(),
): VersionDelta {
	if (!semver.valid(previousVersion) || !semver.valid(version))
		throw new Error(`Expected exact semantic versions.`)
	const evidence = {
		previousVersion,
		version,
		delta: semver.diff(previousVersion, version) ?? `none`,
	}
	const breaking = semver.gt(version, previousVersion)
		? (typeof policy === `function` ? policy : semverPolicy(policy))(evidence)
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
	const config = value as ReleaseConfig
	if (
		config.version !== undefined &&
		typeof config.version !== `function` &&
		(typeof config.version !== `string` || !semver.valid(config.version))
	)
		throw new Error(`release.version must be an exact version or resolver.`)
	if (config.policy !== undefined && typeof config.policy !== `function`) {
		const policy = config.policy
		if (
			!policy ||
			typeof policy !== `object` ||
			Array.isArray(policy) ||
			Object.keys(policy).some((key) => key !== `beforeV1`)
		)
			throw new Error(`release.policy must be a function or { beforeV1 }.`)
		semverPolicy(policy)
	}
}

export async function resolveReleaseVersion(
	config: ReleaseConfig,
	context: ReleaseVersionContext,
): Promise<string | undefined> {
	validateRelease(config)
	const version =
		typeof config.version === `function`
			? await config.version(context)
			: (config.version ?? context.currentVersion)
	if (version === undefined) return undefined
	if (
		typeof version !== `string` ||
		!semver.valid(version) ||
		semver.lt(version, context.currentVersion)
	)
		throw new Error(
			`Invalid release version for ${context.packageName}; expected a current/newer exact version.`,
		)
	return version
}

/** Removed hooks must fail explicitly, including in untyped JSON configurations. */
export function rejectCertificationOptions(value: object): void {
	for (const key of [`certifyCommand`, `releaseIntent`, `certifyBreaking`]) {
		if (key in value)
			throw new Error(
				`${key} was removed. Use release.version and release.policy instead.`,
			)
	}
}
