import { readFile } from "node:fs/promises"

import semver from "semver"

export type Manifest = {
	name: string
	version: string
	type?: string
	dependencies?: Record<string, string>
	devDependencies?: Record<string, string>
	peerDependencies?: Record<string, string>
	peerDependenciesMeta?: Record<string, { optional?: boolean }>
	breakage?: { candidates?: string[] }
}

export function record(value: unknown): value is Record<string, unknown> {
	return typeof value === `object` && value !== null && !Array.isArray(value)
}

export function packageName(value: string): boolean {
	return /^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/.test(value)
}

export function parseManifest(value: unknown, label: string): Manifest {
	if (
		!record(value) ||
		typeof value.name !== `string` ||
		!packageName(value.name) ||
		typeof value.version !== `string` ||
		!semver.valid(value.version)
	) {
		throw new Error(`Invalid package identity in ${label}.`)
	}
	if (
		value.peerDependenciesMeta !== undefined &&
		(!record(value.peerDependenciesMeta) ||
			Object.values(value.peerDependenciesMeta).some(
				(entry) =>
					!record(entry) ||
					(entry.optional !== undefined && typeof entry.optional !== `boolean`),
			))
	) {
		throw new Error(`Invalid peerDependenciesMeta in ${label}.`)
	}
	for (const field of [
		`dependencies`,
		`devDependencies`,
		`peerDependencies`,
	] as const) {
		const entries = value[field]
		if (
			entries !== undefined &&
			(!record(entries) ||
				Object.entries(entries).some(
					([name, spec]) => !packageName(name) || typeof spec !== `string`,
				))
		) {
			throw new Error(`Invalid ${field} in ${label}.`)
		}
	}
	if (
		value.breakage !== undefined &&
		(!record(value.breakage) ||
			(value.breakage.candidates !== undefined &&
				(!Array.isArray(value.breakage.candidates) ||
					value.breakage.candidates.some(
						(name: unknown) => typeof name !== `string` || !packageName(name),
					))))
	) {
		throw new Error(`Invalid candidate peers in ${label}.`)
	}
	return value as Manifest
}

export async function readManifest(filename: string): Promise<Manifest> {
	return parseManifest(JSON.parse(await readFile(filename, `utf8`)), filename)
}

export function eras(range: string): string[] {
	const parts = range.split(`||`).map((part) => part.trim())
	if (parts.some((part) => !part || semver.validRange(part) === null)) {
		throw new Error(`Invalid peer range: ${range}.`)
	}
	return parts
}

/** Previews only represent an explicitly enrolled exact preview. */
export function matches(version: string, range: string): boolean {
	return eras(range).some((era) =>
		semver.prerelease(version)
			? semver.valid(era.replace(/^=\s*/, ``)) === version
			: semver.satisfies(version, era),
	)
}
