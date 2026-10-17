import { readFile } from "node:fs/promises"
import { valid } from "semver"

export type PeerCase = {
	name: string
	peers: Record<string, string | null>
	embassy?: string
	aliases?: Record<string, string | null>
	groups?: Record<string, string[]>
}
export type Embassy = {
	peers?: string[]
	testPattern: string
	testCommand: string
}
export type PeerSuite = Embassy & { name: string; peers: string[] }
export type PeerConfig = {
	cases?: PeerCase[]
	embassies?: Record<string, Embassy>
	setupCommand?: string
	manifest?: string
	install?: boolean
	testDependencies?: Record<string, string>
	sources?: Record<string, string>
	maxCases?: number
	workspace?: Record<
		string,
		{ directory: string; tagPattern?: string; setupCommand?: string }
	>
}
export function object(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === `object` && !Array.isArray(value)
}

export async function readPeerConfig(filename: string): Promise<PeerConfig> {
	const value: unknown = JSON.parse(await readFile(filename, `utf8`))
	if (
		!object(value) ||
		(value.cases !== undefined && !Array.isArray(value.cases))
	)
		throw new Error(
			`Peer configuration must be an object; cases must be an array.`,
		)
	const supported = new Set([
		`cases`,
		`embassies`,
		`setupCommand`,
		`manifest`,
		`install`,
		`testDependencies`,
		`sources`,
		`maxCases`,
		`workspace`,
	])
	for (const key of Object.keys(value))
		if (!supported.has(key))
			throw new Error(
				`Unknown peer configuration option ${JSON.stringify(key)}. Peer representatives come from exact <peer>_v<label> development aliases.`,
			)
	if (value.embassies !== undefined) {
		if (!object(value.embassies) || !Object.keys(value.embassies).length)
			throw new Error(`embassies must map names to test selections.`)
		for (const [name, embassy] of Object.entries(value.embassies)) {
			if (
				!name.trim() ||
				!object(embassy) ||
				typeof embassy.testPattern !== `string` ||
				!embassy.testPattern.trim() ||
				typeof embassy.testCommand !== `string` ||
				!embassy.testCommand.trim() ||
				(embassy.peers !== undefined &&
					(!Array.isArray(embassy.peers) ||
						!embassy.peers.length ||
						embassy.peers.some((peer) => typeof peer !== `string`)))
			)
				throw new Error(
					`Embassy ${name} needs testPattern, testCommand, and optionally a nonempty peers array.`,
				)
		}
	}
	if (value.workspace !== undefined) {
		if (!object(value.workspace))
			throw new Error(`workspace must map peers to Git source configuration.`)
		for (const [peer, entry] of Object.entries(value.workspace)) {
			if (
				!object(entry) ||
				typeof entry.directory !== `string` ||
				(entry.tagPattern !== undefined &&
					typeof entry.tagPattern !== `string`) ||
				(entry.setupCommand !== undefined &&
					typeof entry.setupCommand !== `string`)
			)
				throw new Error(
					`Workspace peer ${peer} needs a directory and optional tagPattern and setupCommand strings.`,
				)
		}
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
	if (
		value.maxCases !== undefined &&
		(typeof value.maxCases !== `number` ||
			!Number.isSafeInteger(value.maxCases) ||
			value.maxCases < 1)
	)
		throw new Error(`maxCases must be a positive integer.`)
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
	return { install: true, ...value } as PeerConfig
}

export function peerSuites(
	config: PeerConfig,
	names: string[],
	fallback?: {
		testPattern?: string | undefined
		testCommand?: string | undefined
	},
): PeerSuite[] {
	const suites: PeerSuite[] = config.embassies
		? Object.entries(config.embassies).map(([name, embassy]) => ({
				...embassy,
				name,
				peers: embassy.peers ?? [name],
			}))
		: [
				{
					name: `peers`,
					peers: names,
					testPattern: fallback?.testPattern ?? ``,
					testCommand: fallback?.testCommand ?? ``,
				},
			]
	for (const suite of suites) {
		if (!suite.testPattern || !suite.testCommand)
			throw new Error(
				`Embassy ${suite.name} needs testPattern and testCommand in the peer configuration or command options.`,
			)
		if (
			!suite.peers.length ||
			suite.peers.some((name) => !names.includes(name))
		)
			throw new Error(
				`Embassy ${suite.name} must select declared peerDependencies: ${names.join(`, `)}.`,
			)
	}
	for (const peer of names)
		if (!suites.some((suite) => suite.peers.includes(peer)))
			throw new Error(
				`Peer ${peer} has no embassy suite. Add an embassy selecting this peer.`,
			)
	return suites
}
