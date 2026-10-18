import path from "node:path"

import { eras, packageName, record } from "./manifest.ts"
import type { NpmConfig } from "./types.ts"

function nonempty(value: unknown): value is string {
	return typeof value === `string` && value.trim().length > 0
}

export function validateConfig(value: unknown): asserts value is NpmConfig {
	if (!record(value)) throw new Error(`Configuration must have an npm object.`)
	for (const key of [`artifact`, `lockfile`, `prepareCommand`] as const) {
		if (!nonempty(value[key]))
			throw new Error(`npm.${key} must be a nonempty string.`)
	}
	if (
		path.isAbsolute(value.lockfile as string) ||
		(value.lockfile as string).split(/[\\/]/).includes(`..`)
	) {
		throw new Error(`npm.lockfile must stay inside each representative.`)
	}
	for (const key of [`packageDirectory`, `installCommand`] as const) {
		if (value[key] !== undefined && !nonempty(value[key]))
			throw new Error(`Invalid npm.${key}.`)
	}
	const globs =
		typeof value.representatives === `string`
			? [value.representatives]
			: value.representatives
	if (
		!Array.isArray(globs) ||
		!globs.length ||
		globs.some((glob: unknown) => !nonempty(glob))
	) {
		throw new Error(`npm.representatives must contain directory globs.`)
	}
	if (!record(value.suites) || !Object.keys(value.suites).length)
		throw new Error(`Configure at least one npm peer suite.`)
	for (const [peer, suite] of Object.entries(value.suites)) {
		if (
			!packageName(peer) ||
			!record(suite) ||
			!nonempty(suite.command) ||
			!Array.isArray(suite.files) ||
			!suite.files.length ||
			suite.files.some((file: unknown) => !nonempty(file))
		) {
			throw new Error(`Invalid npm suite for ${peer}.`)
		}
	}
	if (
		!record(value.baseline) ||
		(`firstRelease` in value.baseline
			? value.baseline.firstRelease !== true ||
				Object.keys(value.baseline).length !== 1
			: Object.entries(value.baseline).some(
					([key, item]) =>
						![`tagPattern`, `baselineFile`].includes(key) || !nonempty(item),
				))
	) {
		throw new Error(
			`Configure npm.baseline with tagPattern/baselineFile or { firstRelease: true }.`,
		)
	}
	if (value.localPeers !== undefined) {
		if (!record(value.localPeers)) throw new Error(`Invalid npm.localPeers.`)
		for (const [peer, local] of Object.entries(value.localPeers)) {
			if (
				!packageName(peer) ||
				!record(local) ||
				!nonempty(local.directory) ||
				!nonempty(local.artifact)
			) {
				throw new Error(`Invalid local peer ${peer}.`)
			}
		}
	}
	for (const hook of [`releaseIntent`, `certifyBreaking`] as const) {
		if (value[hook] !== undefined && typeof value[hook] !== `function`)
			throw new Error(`npm.${hook} must be a function.`)
	}
}

export function validatePeerRanges(peers: Record<string, string>): void {
	for (const range of Object.values(peers)) eras(range)
}
