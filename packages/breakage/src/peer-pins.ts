import { satisfies, valid, validRange } from "semver"

import type { PeerSupport } from "./peer-support.ts"

export type PeerPin = { alias: string; version: string; groups: string[] }
export type PeerPins = Record<string, PeerPin[]>

/** Preserve each declared alternative, including overlapping alternatives. */
export function peerGroups(peer: string, range: string): string[] {
	if (!validRange(range))
		throw new Error(
			`peerDependencies[${JSON.stringify(peer)}] has invalid semver range ${JSON.stringify(range)}. Separate alternatives with ||.`,
		)
	return range.split(`||`).map((group) => group.trim())
}

/** Names identify peers; only npm alias targets and semver determine coverage. */
export function resolvePeerPins(support: PeerSupport): PeerPins {
	const pins: PeerPins = Object.create(null) as PeerPins
	const errors: string[] = []
	const peers = Object.keys(support.ranges)
	for (const peer of peers) {
		const range = support.ranges[peer]!
		const groups = peerGroups(peer, range)
		const selected: PeerPin[] = []
		for (const [alias, specifier] of Object.entries(
			support.devDependencies ?? {},
		)) {
			const target = /^npm:((?:@[^/]+\/)?[^@]+)@(.+)$/.exec(specifier)
			const namedForPeer = alias.startsWith(`${peer}_v`)
			if (!namedForPeer && (target?.[1] !== peer || alias === peer)) continue
			const location = `devDependencies[${JSON.stringify(alias)}]`
			if (!namedForPeer || alias === `${peer}_v`) {
				errors.push(
					`${location} targets peer ${peer}, but its name must be ${peer}_v<label>. Rename the alias; the label is descriptive only.`,
				)
				continue
			}
			if (!target || target[1] !== peer) {
				errors.push(
					`${location} is ${JSON.stringify(specifier)}; expected npm:${peer}@<exact-version>. The alias must target peer ${peer}.`,
				)
				continue
			}
			const version = target[2]!
			if (valid(version) !== version) {
				errors.push(
					`${location} is ${JSON.stringify(specifier)}; pin an exact version such as npm:${peer}@1.2.3. Ranges and tags cannot identify a reproducible embassy environment.`,
				)
				continue
			}
			const matching = groups.filter((group) => satisfies(version, group))
			if (!matching.length) {
				errors.push(
					`${location} pins ${peer}@${version}, outside peerDependencies[${JSON.stringify(peer)}] ${JSON.stringify(range)}. Update the pin or the declared support range.`,
				)
				continue
			}
			selected.push({ alias, version, groups: matching })
		}
		for (const group of groups) {
			if (!selected.some((pin) => pin.groups.includes(group)))
				errors.push(
					`Peer ${peer} has no pinned development alias satisfying group ${JSON.stringify(group)}. Add ${peer}_v<label>: npm:${peer}@<exact-version> matching this group. Available pins: ${selected.map((pin) => `${pin.alias}=${pin.version}`).join(`, `) || `none`}.`,
				)
		}
		pins[peer] = selected
	}
	// Catch aliases naming a peer that is no longer declared, without reserving _v
	// in unrelated ordinary development dependency names.
	for (const [alias, specifier] of Object.entries(
		support.devDependencies ?? {},
	)) {
		const target = /^npm:((?:@[^/]+\/)?[^@]+)@(.+)$/.exec(specifier)
		if (
			target &&
			alias.startsWith(`${target[1]}_v`) &&
			!peers.includes(target[1]!)
		)
			errors.push(
				`devDependencies[${JSON.stringify(alias)}] targets undeclared peer ${target[1]}. Declare it in peerDependencies or remove the embassy alias.`,
			)
	}
	if (errors.length)
		throw new Error(
			`Invalid peer development dependency mapping:\n${errors.map((error) => `- ${error}`).join(`\n`)}`,
		)
	return pins
}
