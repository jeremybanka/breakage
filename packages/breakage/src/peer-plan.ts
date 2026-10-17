import { createHash, randomUUID } from "node:crypto"
import {
	copyFile,
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	rename,
	rm,
	writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { valid } from "semver"
import { simpleGit } from "simple-git"

import {
	copyRegistryConfig,
	installPeerEnvironment,
	preparePeerInstall,
	runFile,
} from "./peer-install.ts"
import { object, peerSuites, validatePeerConfig } from "./peer-config.ts"
import type { PeerEnvironment, PeerConfig, PeerSuite } from "./peer-config.ts"
import { readPeerSupport } from "./peer-support.ts"
import type { PeerSupport } from "./peer-support.ts"
import { resolvePeerPins } from "./peer-pins.ts"

export type PeerInstallation = {
	candidate: string
	manifest: string
	lockfile: string
	workspaceConfig: string
	artifacts: { filename: string; file: string; integrity: string }[]
}
export type PeerPlan = {
	version: 2
	suites: PeerSuite[]
	configHash: string
	candidateCommit: string
	environments: PeerEnvironment[]
	excluded: { environment: PeerEnvironment; reason: string }[]
	packageManager?: string
	installations?: Record<string, PeerInstallation>
}

export function digest(value: string | Uint8Array): string {
	return createHash(`sha256`).update(value).digest(`hex`)
}

export async function resolvePeerEnvironments(
	config: PeerConfig,
	support: PeerSupport,
	_sourcingDirectory: string,
	suites?: PeerSuite[],
): Promise<PeerEnvironment[]> {
	const pins = resolvePeerPins(support)
	const maxEnvironments = config.maxEnvironments ?? 32
	const names = Object.keys(support.ranges).sort()
	if (!names.length)
		throw new Error(`Embassy checks need declared peerDependencies.`)
	const results: PeerEnvironment[] = []
	for (const suite of suites ?? [{ name: `peers`, peers: names }]) {
		let combinations: Record<string, string | null>[] = [{}]
		for (const name of names) {
			const versions: (string | null)[] = [
				...new Set(pins[name]!.map((pin) => pin.version)),
			]
			if (support.optional.includes(name)) versions.push(null)
			const choices = suite.peers.includes(name)
				? versions
				: versions.slice(0, 1)
			if (
				combinations.length * choices.length + results.length >
				maxEnvironments
			)
				throw new Error(
					`Peer matrix exceeds maxEnvironments (${maxEnvironments}) in embassy ${suite.name}. Narrow the embassy peer selection or raise the limit; no pins were silently skipped.`,
				)
			combinations = combinations.flatMap((peers) =>
				choices.map((version) => ({ ...peers, [name]: version })),
			)
		}
		const environments = combinations.map((peers) => ({
			name: Object.entries(peers)
				.map(([name, version]) => `${name}@${version ?? `absent`}`)
				.join(` + `),
			peers,
		}))
		const seen = new Set<string>()
		for (const entry of environments) {
			const peers = { ...entry.peers }
			const aliases: Record<string, string | null> = {}
			const groups: Record<string, string[]> = {}
			for (const [name, version] of Object.entries(peers)) {
				const pin = pins[name]!.find((pin) => pin.version === version)
				aliases[name] = pin?.alias ?? null
				groups[name] = pin?.groups ?? []
			}
			const key = JSON.stringify(
				Object.entries(peers).sort(([a], [b]) => a.localeCompare(b)),
			)
			if (seen.has(key)) continue
			seen.add(key)
			results.push({
				name: suites ? `${suite.name}: ${entry.name}` : entry.name,
				peers,
				embassy: suite.name,
				aliases,
				groups,
			})
		}
	}
	if (!results.length || results.length > maxEnvironments)
		throw new Error(
			`Peer matrix must contain 1 to maxEnvironments (${maxEnvironments}) environments.`,
		)
	return results
}

export async function preparePeerPlan(
	baseDirname: string,
	peerConfig: PeerConfig,
	artifactDirectory: string,
): Promise<PeerPlan> {
	const config = validatePeerConfig(peerConfig)
	const git = simpleGit(baseDirname)
	if (!(await git.status()).isClean())
		throw new Error(
			`The git repository must be clean to prepare peer environments.`,
		)
	const candidateCommit = await git.revparse([`HEAD`])
	const support = await readPeerSupport(
		git,
		candidateCommit,
		config.manifest ?? `package.json`,
	)
	const suites = peerSuites(config, Object.keys(support.ranges))
	const environments = await resolvePeerEnvironments(
		config,
		support,
		baseDirname,
		suites,
	)
	const plan: PeerPlan = {
		version: 2,
		suites,
		configHash: digest(JSON.stringify(config)),
		candidateCommit,
		environments,
		excluded: [],
	}
	if (config.install) {
		plan.packageManager = await runFile(`pnpm`, [`--version`], baseDirname)
		plan.installations = Object.create(null) as Record<string, PeerInstallation>
		await mkdir(artifactDirectory, { recursive: true })
		for (const entry of environments) {
			const temporary = await mkdtemp(
				path.join(tmpdir(), `breakage-peer-plan-`),
			)
			try {
				const candidate = await preparePeerInstall(
					config,
					entry,
					baseDirname,
					temporary,
				)
				try {
					await installPeerEnvironment(temporary, false, true)
				} catch (error) {
					// Only an explicit dependency conflict can rule out a combination.
					// Registry, archive, and build failures must remain setup errors.
					if (
						!(error instanceof Error) ||
						!error.message.includes(`ERR_PNPM_PEER_DEP_ISSUES`)
					)
						throw error
					plan.excluded.push({ environment: entry, reason: error.message })
					continue
				}
				const artifacts: PeerInstallation[`artifacts`] = []
				for (const filename of (
					await readdir(path.join(temporary, `.breakage-artifacts`))
				).sort()) {
					const contents = await readFile(
						path.join(temporary, `.breakage-artifacts`, filename),
					)
					const integrity = digest(contents)
					const destination = path.join(artifactDirectory, `${integrity}.tgz`)
					const temporaryArtifact = `${destination}.${randomUUID()}.tmp`
					try {
						await writeFile(temporaryArtifact, contents)
						await rename(temporaryArtifact, destination)
					} finally {
						await rm(temporaryArtifact, { force: true })
					}
					artifacts.push({
						filename,
						file: path.relative(baseDirname, destination),
						integrity,
					})
				}
				plan.installations[entry.name] = {
					candidate,
					manifest: await readFile(
						path.join(temporary, `package.json`),
						`utf8`,
					),
					lockfile: await readFile(
						path.join(temporary, `pnpm-lock.yaml`),
						`utf8`,
					),
					workspaceConfig: await readFile(
						path.join(temporary, `pnpm-workspace.yaml`),
						`utf8`,
					),
					artifacts,
				}
			} finally {
				await rm(temporary, { recursive: true, force: true })
			}
		}
	}
	plan.environments = environments.filter(
		(entry) =>
			!plan.excluded.some(({ environment }) => environment.name === entry.name),
	)
	assertPeerCoverage(environments, plan.environments, suites, plan.excluded)
	return plan
}

export function assertPeerCoverage(
	expected: PeerEnvironment[],
	viable: PeerEnvironment[],
	suites: PeerSuite[],
	excluded: PeerPlan[`excluded`],
): void {
	const missing = new Set<string>()
	for (const suite of suites) {
		for (const entry of expected.filter(
			(entry) => entry.embassy === suite.name,
		)) {
			for (const peer of suite.peers) {
				if (
					!viable.some(
						(other) =>
							other.embassy === suite.name &&
							other.peers[peer] === entry.peers[peer],
					)
				)
					missing.add(
						`Embassy ${suite.name}: ${entry.aliases?.[peer] ?? peer} (${peer}@${entry.peers[peer] ?? `absent`}, groups: ${entry.groups?.[peer]?.join(` || `) || `optional absence`}) has no compatible environment.`,
					)
			}
		}
	}
	if (missing.size)
		throw new Error(
			`Invalid peer compatibility mapping:\n${[...missing].map((message) => `- ${message}`).join(`\n`)}\nUpdate the pinned aliases or declared support ranges so every representative and optional absence can be exercised.\n${excluded.map(({ environment, reason }) => `${environment.name}: ${reason}`).join(`\n`)}`,
		)
}

export function isPeerPlan(value: unknown): value is PeerPlan {
	if (
		!object(value) ||
		value.version !== 2 ||
		!Array.isArray(value.suites) ||
		value.suites.some(
			(suite) =>
				!object(suite) ||
				typeof suite.name !== `string` ||
				typeof suite.testPattern !== `string` ||
				typeof suite.testCommand !== `string` ||
				!Array.isArray(suite.peers) ||
				suite.peers.some((peer) => typeof peer !== `string`),
		) ||
		typeof value.configHash !== `string` ||
		!/^[a-f0-9]{64}$/.test(value.configHash) ||
		typeof value.candidateCommit !== `string` ||
		!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(value.candidateCommit) ||
		!Array.isArray(value.excluded) ||
		value.excluded.some(
			(entry) =>
				!object(entry) ||
				!object(entry.environment) ||
				typeof entry.environment.name !== `string` ||
				typeof entry.reason !== `string`,
		) ||
		!Array.isArray(value.environments) ||
		!value.environments.length
	)
		return false
	if (
		value.environments.some(
			(entry) =>
				!object(entry) ||
				typeof entry.name !== `string` ||
				!object(entry.peers) ||
				Object.values(entry.peers).some(
					(version) =>
						version !== null &&
						(typeof version !== `string` || valid(version) !== version),
				),
		)
	)
		return false
	if (value.installations !== undefined) {
		if (
			!object(value.installations) ||
			typeof value.packageManager !== `string`
		)
			return false
		for (const installation of Object.values(value.installations)) {
			if (
				!object(installation) ||
				typeof installation.candidate !== `string` ||
				typeof installation.manifest !== `string` ||
				typeof installation.lockfile !== `string` ||
				typeof installation.workspaceConfig !== `string` ||
				!Array.isArray(installation.artifacts) ||
				installation.artifacts.some(
					(artifact) =>
						!object(artifact) ||
						typeof artifact.filename !== `string` ||
						path.basename(artifact.filename) !== artifact.filename ||
						typeof artifact.file !== `string` ||
						typeof artifact.integrity !== `string` ||
						!/^[a-f0-9]{64}$/.test(artifact.integrity),
				)
			)
				return false
		}
	}
	return true
}

export async function restorePeerInstall(
	installation: PeerInstallation,
	source: string,
	target: string,
): Promise<void> {
	await copyRegistryConfig(source, target)
	await mkdir(path.join(target, `.breakage-artifacts`), { recursive: true })
	for (const artifact of installation.artifacts) {
		const filename = path.resolve(source, artifact.file)
		if (digest(await readFile(filename)) !== artifact.integrity)
			throw new Error(
				`Peer artifact integrity mismatch: ${artifact.file}. Run breakage prelude again.`,
			)
		await copyFile(
			filename,
			path.join(target, `.breakage-artifacts`, artifact.filename),
		)
	}
	await writeFile(path.join(target, `package.json`), installation.manifest)
	await writeFile(path.join(target, `pnpm-lock.yaml`), installation.lockfile)
	await writeFile(
		path.join(target, `pnpm-workspace.yaml`),
		installation.workspaceConfig,
	)
}
