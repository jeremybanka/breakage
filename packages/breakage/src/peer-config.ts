import { readFile } from "node:fs/promises"
import { prerelease, valid } from "semver"

export type PeerCase = { name: string; peers: Record<string, string | null> }
export type PeerConfig = {
	cases?: PeerCase[]
	resolve?: boolean
	setupCommand?: string
	manifest?: string
	install?: boolean
	testDependencies?: Record<string, string>
	sources?: Record<string, string>
	maxCases?: number
	prereleases?: `exclude` | `include`
	unbounded?: `error` | `published`
}
export function object(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === `object` && !Array.isArray(value)
}

export async function readPeerConfig(filename: string): Promise<PeerConfig> {
	const value: unknown = JSON.parse(await readFile(filename, `utf8`))
	if (
		!object(value) ||
		(value.cases !== undefined && !Array.isArray(value.cases)) ||
		(!value.resolve &&
			(!Array.isArray(value.cases) || value.cases.length === 0))
	) {
		throw new Error(`Peer configuration must contain a nonempty cases array.`)
	}
	const names = new Set<string>()
	for (const entry of (value.cases ?? []) as unknown[]) {
		if (
			!object(entry) ||
			typeof entry.name !== `string` ||
			!entry.name.trim() ||
			names.has(entry.name) ||
			!object(entry.peers)
		) {
			throw new Error(`Each peer case needs a unique name and a peers object.`)
		}
		names.add(entry.name)
		for (const [name, version] of Object.entries(entry.peers)) {
			if (
				!/^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(name) ||
				(version !== null &&
					(typeof version !== `string` || valid(version) !== version))
			)
				throw new Error(
					`Peer ${name} in ${entry.name} must select an exact version.`,
				)
		}
	}
	if (
		value.setupCommand !== undefined &&
		typeof value.setupCommand !== `string`
	)
		throw new Error(`setupCommand must be a string.`)
	if (value.manifest !== undefined && typeof value.manifest !== `string`)
		throw new Error(`manifest must be a string.`)
	if (value.install !== undefined && typeof value.install !== `boolean`)
		throw new Error(`install must be a boolean.`)
	if (value.resolve !== undefined && typeof value.resolve !== `boolean`)
		throw new Error(`resolve must be a boolean.`)
	if (
		value.maxCases !== undefined &&
		(typeof value.maxCases !== `number` ||
			!Number.isSafeInteger(value.maxCases) ||
			value.maxCases < 1)
	)
		throw new Error(`maxCases must be a positive integer.`)
	if (
		value.prereleases !== undefined &&
		value.prereleases !== `include` &&
		value.prereleases !== `exclude`
	)
		throw new Error(`prereleases must be include or exclude.`)
	if (
		value.unbounded !== undefined &&
		value.unbounded !== `error` &&
		value.unbounded !== `published`
	)
		throw new Error(`unbounded must be error or published.`)
	for (const entry of (value.cases ?? []) as PeerCase[]) {
		if (
			value.prereleases !== `include` &&
			Object.values(entry.peers).some(
				(version) => version !== null && prerelease(version),
			)
		)
			throw new Error(
				`Prerelease peer selections require prereleases: include.`,
			)
	}
	for (const key of [`testDependencies`, `sources`] as const) {
		if (
			value[key] !== undefined &&
			(!object(value[key]) ||
				Object.values(value[key]).some((entry) => typeof entry !== `string`))
		)
			throw new Error(`${key} must map names to strings.`)
	}
	if (
		object(value.testDependencies) &&
		Object.values(value.testDependencies).some(
			(version) => typeof version !== `string` || valid(version) !== version,
		)
	)
		throw new Error(`testDependencies must use exact versions.`)
	return value as PeerConfig
}
