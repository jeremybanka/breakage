import path from "node:path"

import { satisfies, subset, validRange } from "semver"
import type { SimpleGit } from "simple-git"

import { object } from "./peer-matrix.ts"

export type PeerSupport = { ranges: Record<string, string> }
export type PeerSupportChange = {
	peer: string
	released: string
	proposed: string | null
}

export async function readPeerSupport(
	git: SimpleGit,
	commit: string,
	manifest: string,
): Promise<PeerSupport> {
	if (path.isAbsolute(manifest) || manifest.split(/[\\/]/).includes(`..`))
		throw new Error(`Peer manifest must be a path inside the package.`)
	const prefix = await git.revparse([`--show-prefix`])
	const value: unknown = JSON.parse(
		await git.show([`${commit}:${prefix}${manifest}`]),
	)
	if (!object(value))
		throw new Error(`Invalid package manifest at ${commit}:${manifest}.`)
	const ranges = value.peerDependencies ?? {}
	if (!object(ranges)) throw new Error(`peerDependencies must be an object.`)
	for (const [name, range] of Object.entries(ranges)) {
		if (typeof range !== `string` || !validRange(range))
			throw new Error(`Peer ${name} must declare a semantic version range.`)
	}
	return { ranges: ranges as Record<string, string> }
}

export function droppedSupport(
	released: PeerSupport,
	proposed: PeerSupport,
): PeerSupportChange[] {
	return Object.entries(released.ranges)
		.filter(
			([name, range]) =>
				proposed.ranges[name] === undefined ||
				!subset(range, proposed.ranges[name]!),
		)
		.map(([peer, range]) => ({
			peer,
			released: range,
			proposed: proposed.ranges[peer] ?? null,
		}))
}

export function supports(
	support: PeerSupport,
	peers: Record<string, string>,
): boolean {
	return Object.entries(peers).every(
		([name, version]) =>
			support.ranges[name] !== undefined &&
			satisfies(version, support.ranges[name]!),
	)
}
