import path from "node:path"

import { satisfies, subset, validRange } from "semver"
import { simpleGit } from "simple-git"
import type { SimpleGit } from "simple-git"

import { object } from "./peer-config.ts"

export type PeerSupport = {
	ranges: Record<string, string>
	optional: string[]
	devDependencies?: Record<string, string>
}
export type PeerSupportChange = {
	peer: string
	released: string
	proposed: string | null
	reason: `range-narrowed` | `peer-required`
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
	const metadata = value.peerDependenciesMeta ?? {}
	if (!object(metadata))
		throw new Error(`peerDependenciesMeta must be an object.`)
	const optional: string[] = []
	for (const [name, range] of Object.entries(ranges)) {
		if (typeof range !== `string`)
			throw new Error(
				`peerDependencies[${JSON.stringify(name)}] must declare a valid semantic version range; separate alternatives with ||.`,
			)
		if (range.startsWith(`workspace:`)) {
			const requested = range.slice(`workspace:`.length)
			if ([`*`, `^`, `~`].includes(requested)) {
				const rootGit = simpleGit(await git.revparse([`--show-toplevel`]))
				const files = (
					await rootGit.raw([`ls-tree`, `-r`, `--name-only`, commit])
				)
					.split(`\n`)
					.filter(
						(file) => file === `package.json` || file.endsWith(`/package.json`),
					)
				let version: string | undefined
				for (const file of files) {
					const peer: unknown = JSON.parse(
						await rootGit.show([`${commit}:${file}`]),
					)
					if (
						object(peer) &&
						peer.name === name &&
						typeof peer.version === `string`
					) {
						version = peer.version
						break
					}
				}
				if (!version)
					throw new Error(`Cannot resolve workspace peer ${name} at ${commit}.`)
				ranges[name] = `${requested === `*` ? `` : requested}${version}`
			} else ranges[name] = requested
		}
		if (!validRange(ranges[name] as string))
			throw new Error(
				`peerDependencies[${JSON.stringify(name)}] must declare a valid semantic version range; separate alternatives with ||.`,
			)
		const meta = metadata[name]
		if (object(meta) && meta.optional === true) optional.push(name)
	}
	const devDependencies = value.devDependencies ?? {}
	if (
		!object(devDependencies) ||
		Object.values(devDependencies).some((entry) => typeof entry !== `string`)
	)
		throw new Error(`devDependencies must map package names to strings.`)
	return {
		ranges: ranges as Record<string, string>,
		optional,
		devDependencies: devDependencies as Record<string, string>,
	}
}

export function droppedSupport(
	released: PeerSupport,
	proposed: PeerSupport,
): PeerSupportChange[] {
	const changes: PeerSupportChange[] = Object.entries(released.ranges)
		.filter(
			([name, range]) =>
				proposed.ranges[name] === undefined ||
				!subset(range, proposed.ranges[name]!),
		)
		.map(([peer, range]) => ({
			peer,
			released: range,
			proposed: proposed.ranges[peer] ?? null,
			reason: `range-narrowed`,
		}))
	for (const [peer, range] of Object.entries(proposed.ranges)) {
		if (
			!proposed.optional.includes(peer) &&
			(!Object.hasOwn(released.ranges, peer) ||
				released.optional.includes(peer))
		)
			changes.push({
				peer,
				released: released.ranges[peer] ?? `absent`,
				proposed: range,
				reason: `peer-required`,
			})
	}
	return changes
}

export function supports(
	support: PeerSupport,
	peers: Record<string, string | null>,
	includePrerelease = false,
): boolean {
	return (
		Object.keys(support.ranges).every(
			(name) =>
				(peers[name] !== undefined && peers[name] !== null) ||
				support.optional.includes(name),
		) &&
		Object.entries(peers).every(([name, version]) =>
			version === null
				? !Object.hasOwn(support.ranges, name) ||
					support.optional.includes(name)
				: Object.hasOwn(support.ranges, name) &&
					satisfies(version, support.ranges[name]!, { includePrerelease }),
		)
	)
}
