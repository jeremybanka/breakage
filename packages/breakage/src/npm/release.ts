import path from "node:path"

import semver from "semver"
import { simpleGit } from "simple-git"

import {
	resolveReleaseVersion,
	type ReleaseVersionContext,
} from "../release.ts"
import { readBaseline } from "../baseline.ts"
import { withDirectoryLock } from "../directory-lock.ts"
import { latestReleaseTag } from "../release-tag.ts"
import { validatePeerRanges } from "./config.ts"
import type { Manifest } from "./manifest.ts"
import { normalizeWorkspacePeers, parseManifest } from "./manifest.ts"
import type { NpmConfig, SupportChange } from "./types.ts"

export async function releaseVersion(
	config: NpmConfig,
	context: ReleaseVersionContext,
): Promise<string | undefined> {
	return config.release
		? await resolveReleaseVersion(config.release, context)
		: undefined
}

/**
 * Compare the union, including adjacent alternatives. semver.subset compares each
 * conjunction to a single conjunction and cannot prove coverage by their union.
 * Membership can change only at comparator boundaries or prerelease tuple gates.
 */
export function includesRange(current: string, previous: string): boolean {
	const ranges = [new semver.Range(previous), new semver.Range(current)]
	const samples = new Set<string>([`0.0.0`, `0.0.0-0`])
	for (const range of ranges) {
		for (const conjunction of range.set) {
			for (const comparator of conjunction) {
				const version = comparator.semver
				if (typeof version === `symbol`) continue
				const base = `${version.major}.${version.minor}.${version.patch}`
				samples.add(version.version)
				samples.add(base)
				samples.add(`${base}-0`)
				// The immediate successor in a prerelease sequence appends numeric zero.
				if (version.prerelease.length) samples.add(`${version.version}.0`)
				// Stable versions are discrete; the next patch starts another tuple gate.
				const next = semver.inc(base, `patch`)
				if (next) {
					samples.add(next)
					samples.add(`${next}-0`)
				}
			}
		}
	}
	return [...samples].every(
		(version) =>
			!semver.satisfies(version, previous) ||
			semver.satisfies(version, current),
	)
}

export function supportChanges(
	previous: Manifest,
	current: Manifest,
): SupportChange[] {
	const before = previous.peerDependencies ?? {}
	const after = current.peerDependencies ?? {}
	validatePeerRanges(before)
	validatePeerRanges(after)
	return Object.entries(after).flatMap(([peer, range]) => {
		const old = before[peer]
		const wasOptional = previous.peerDependenciesMeta?.[peer]?.optional === true
		const isOptional = current.peerDependenciesMeta?.[peer]?.optional === true
		// Absence scenarios are not generated, but making an optional peer required
		// still changes the installation contract for existing consumers.
		return (old === undefined && isOptional) ||
			(old !== undefined &&
				includesRange(range, old) &&
				!(wasOptional && !isOptional))
			? []
			: [
					{
						peer,
						reason:
							old === undefined || (wasOptional && !isOptional)
								? (`required-peer` as const)
								: (`narrowed-range` as const),
						previous: old ?? null,
						current: range,
					},
				]
	})
}

export async function previousManifest(
	config: NpmConfig,
	directory: string,
): Promise<Manifest | undefined> {
	if (`firstRelease` in config.baseline) return undefined
	const git = simpleGit(directory)
	let commit: string
	if (config.baseline.baselineFile) {
		commit = (
			await readBaseline(
				git,
				path.resolve(directory, config.baseline.baselineFile),
				config.baseline,
			)
		).commit
	} else {
		const tags = await git.listRemote([`--tags`, `origin`])
		const ref = latestReleaseTag(tags, config.baseline.tagPattern)
		if (!ref)
			throw new Error(
				`No npm release baseline found; configure a tag pattern or explicitly declare firstRelease.`,
			)
		const refs = new Map(
			tags
				.trim()
				.split(`\n`)
				.map((line) => {
					const [sha, name] = line.split(`\t`)
					return [name, sha]
				}),
		)
		const resolved = refs.get(`${ref}^{}`) ?? refs.get(ref)
		if (!resolved || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(resolved))
			throw new Error(`Invalid release commit for ${ref}.`)
		commit = resolved
		const common = await git.revparse([
			`--path-format=absolute`,
			`--git-common-dir`,
		])
		await withDirectoryLock(path.join(common, `breakage-fetch.lock`), () =>
			git.fetch([`origin`, commit, `--no-tags`, `--no-write-fetch-head`]),
		)
	}
	const prefix = await git.revparse([`--show-prefix`])
	const manifest = parseManifest(
		JSON.parse(await git.show([`${commit}:${prefix}package.json`])),
		`release ${commit}`,
	)
	return await normalizeWorkspacePeers(manifest, async (peer) => {
		const local = config.localPeers?.[peer]
		if (!local)
			throw new Error(
				`Historical workspace peer ${peer} needs a localPeers directory to resolve release ${commit}.`,
			)
		const root = await git.revparse([`--show-toplevel`])
		const relative = path.relative(
			root,
			path.resolve(directory, local.directory),
		)
		if (
			relative === `..` ||
			relative.startsWith(`..${path.sep}`) ||
			path.isAbsolute(relative)
		)
			throw new Error(
				`Historical workspace peer ${peer} escapes the release repository.`,
			)
		const filename = path
			.join(relative, `package.json`)
			.split(path.sep)
			.join(`/`)
		const historical = parseManifest(
			JSON.parse(await git.show([`${commit}:${filename}`])),
			`release ${commit}:${filename}`,
		)
		if (historical.name !== peer)
			throw new Error(
				`Historical workspace peer identity mismatch for ${peer}.`,
			)
		return historical.version
	})
}
