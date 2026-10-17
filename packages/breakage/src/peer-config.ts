import { valid } from "semver"

export type PeerEnvironment = {
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
	embassies?: Record<string, Embassy>
	setupCommand?: string
	manifest?: string
	installer?: `pnpm`
	prepareCommand?: string
	verifyCommand?: string
	testDependencies?: Record<string, string>
	sources?: Record<string, string>
	maxEnvironments?: number
	workspace?: Record<
		string,
		{ directory: string; tagPattern?: string; setupCommand?: string }
	>
}
export function object(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === `object` && !Array.isArray(value)
}

export function validatePeerConfig(value: unknown): PeerConfig {
	if (!object(value)) throw new Error(`Peer options must be an object.`)
	if (value.cases !== undefined)
		throw new Error(
			`Remove cases: embassy environments are inferred from peerDependencies and exact <peer>_v<label> development aliases.`,
		)
	const supported = new Set([
		`embassies`,
		`setupCommand`,
		`manifest`,
		`installer`,
		`prepareCommand`,
		`verifyCommand`,
		`testDependencies`,
		`sources`,
		`maxEnvironments`,
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
			if (entry.setupCommand !== undefined && value.installer !== `pnpm`)
				throw new Error(
					`workspace[${JSON.stringify(peer)}].setupCommand requires installer: "pnpm"; build historical sources from prepareCommand for repository-defined preparation.`,
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
	if (value.installer !== undefined && value.installer !== `pnpm`)
		throw new Error(
			`installer must be "pnpm"; use prepareCommand for repository-defined preparation.`,
		)
	for (const key of [`prepareCommand`, `verifyCommand`] as const)
		if (
			value[key] !== undefined &&
			(typeof value[key] !== `string` || !value[key].trim())
		)
			throw new Error(`${key} must be a nonempty command.`)
	if (value.installer && value.prepareCommand)
		throw new Error(`Choose either installer: "pnpm" or prepareCommand.`)
	if (value.verifyCommand && !value.prepareCommand)
		throw new Error(`verifyCommand requires prepareCommand.`)
	if (
		value.maxEnvironments !== undefined &&
		(typeof value.maxEnvironments !== `number` ||
			!Number.isSafeInteger(value.maxEnvironments) ||
			value.maxEnvironments < 1)
	)
		throw new Error(`maxEnvironments must be a positive integer.`)
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

export function peerSuites(config: PeerConfig, names: string[]): PeerSuite[] {
	if (!config.embassies)
		throw new Error(
			`Configure embassy test selections in breakage.config.json.`,
		)
	const suites: PeerSuite[] = Object.entries(config.embassies).map(
		([name, embassy]) => ({ ...embassy, name, peers: embassy.peers ?? [name] }),
	)
	for (const suite of suites) {
		if (!suite.testPattern || !suite.testCommand)
			throw new Error(
				`Embassy ${suite.name} needs testPattern and testCommand in the embassy configuration.`,
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
