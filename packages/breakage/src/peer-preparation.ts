import { existsSync } from "node:fs"
import { readFile, realpath, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import path from "node:path"

import { simpleGit } from "simple-git"

import { object } from "./peer-config.ts"
import type { PeerConfig, PeerEnvironment } from "./peer-config.ts"
import { command } from "./peer-command.ts"
import { digest } from "./peer-plan.ts"
import type { PeerPlan } from "./peer-plan.ts"
import { createPeerWorktree } from "./peer-worktree.ts"
import type { PeerWorktree } from "./peer-worktree.ts"

export type PeerSource =
	| { kind: `registry` }
	| { kind: `archive`; file: string; integrity: string }
	| { kind: `workspace`; directory: string; commit: string }

export type PeerPreparation = {
	version: 1
	embassy: string
	peers: Record<string, string | null>
	aliases: Record<string, string | null>
	groups: Record<string, string[]>
	root: string
	candidate: { commit: string; directory: string }
	sources: Record<string, PeerSource & { root?: string }>
	testDependencies: Record<string, string>
	resultFile: string
	verifyFile: string
}
export type PeerPreparationResult =
	| { status: `ready`; candidateDirectory?: string }
	| { status: `incompatible`; reason: string }
export type PeerBinding = { name: string; version: string; identity: string }
export type PeerVerification = Record<
	string,
	{ tests: PeerBinding | null; candidate: PeerBinding | null }
>

export type PreparedPeerEnvironment = {
	cwd: string
	root: string
	env: NodeJS.ProcessEnv
	resultFile: string
	verifyFile: string
	candidateDirectory: string
	cleanup: () => Promise<void>
}

export async function prepareRepository(
	config: PeerConfig,
	entry: PeerEnvironment,
	source: string,
	plan: PeerPlan,
): Promise<PreparedPeerEnvironment> {
	const git = simpleGit(source)
	const root = await git.revparse([`--show-toplevel`])
	const prefix = await git.revparse([`--show-prefix`])
	const worktrees: PeerWorktree[] = []
	const cleanup = async () => {
		const results = await Promise.allSettled(
			worktrees.map((worktree) => worktree.cleanup()),
		)
		const failures = results.filter((result) => result.status === `rejected`)
		if (failures.length)
			throw new AggregateError(
				failures.map((failure) => failure.reason),
				`Failed to remove preparation worktrees.`,
			)
	}
	try {
		const candidate = await createPeerWorktree(root, plan.candidateCommit)
		worktrees.push(candidate)
		const cwd = path.join(candidate.directory, prefix)
		const candidateDirectory = path.dirname(
			path.join(cwd, config.manifest ?? `package.json`),
		)
		const sources: PeerPreparation[`sources`] = {}
		for (const [peer, version] of Object.entries(entry.peers)) {
			if (version === null) continue
			const selection = plan.sources?.[`${peer}@${version}`]
			if (!selection)
				throw new Error(
					`Missing prepared source for ${peer}@${version}. Run breakage prelude again.`,
				)
			if (selection.kind === `workspace`) {
				const worktree = await createPeerWorktree(root, selection.commit)
				worktrees.push(worktree)
				sources[peer] = {
					...selection,
					root: worktree.directory,
					directory: path.join(worktree.directory, selection.directory),
				}
			} else if (selection.kind === `archive`) {
				const file = path.resolve(source, selection.file)
				if (digest(await readFile(file)) !== selection.integrity)
					throw new Error(
						`Peer artifact integrity mismatch: ${selection.file}. Run breakage prelude again.`,
					)
				sources[peer] = { ...selection, file }
			} else sources[peer] = selection
		}
		const temporary = path.dirname(candidate.directory)
		const inputFile = path.join(temporary, `preparation.json`)
		const resultFile = path.join(temporary, `preparation-result.json`)
		const verifyFile = path.join(temporary, `verification.json`)
		await writeFile(
			inputFile,
			JSON.stringify(
				{
					version: 1,
					embassy: entry.embassy!,
					peers: entry.peers,
					aliases: entry.aliases ?? {},
					groups: entry.groups ?? {},
					root: candidate.directory,
					candidate: {
						commit: plan.candidateCommit,
						directory: candidateDirectory,
					},
					sources,
					testDependencies: config.testDependencies ?? {},
					resultFile,
					verifyFile,
				} satisfies PeerPreparation,
				null,
				2,
			),
		)
		return {
			cwd,
			root: candidate.directory,
			candidateDirectory,
			resultFile,
			verifyFile,
			cleanup,
			env: {
				...process.env,
				BREAKAGE_PREPARATION: inputFile,
				BREAKAGE_ENVIRONMENT: entry.name,
				BREAKAGE_PEERS: JSON.stringify(entry.peers),
				BREAKAGE_PEER_ALIASES: JSON.stringify(entry.aliases),
				BREAKAGE_EMBASSY: entry.embassy,
				BREAKAGE_CANDIDATE_COMMIT: plan.candidateCommit,
				BREAKAGE_CONTRACT_COMMIT: plan.candidateCommit,
			},
		}
	} catch (error) {
		await cleanup()
		throw error
	}
}

// A zero exit code means ready unless preparation explicitly reports an
// incompatible combination. Build/install errors never imply incompatibility.
export async function preparationConflict(
	prepared: PreparedPeerEnvironment,
): Promise<string | undefined> {
	const filename = prepared.resultFile
	if (!existsSync(filename)) return
	const result: unknown = JSON.parse(await readFile(filename, `utf8`))
	if (object(result) && result.status === `ready`) {
		if (result.candidateDirectory !== undefined) {
			if (typeof result.candidateDirectory !== `string`)
				throw new Error(
					`candidateDirectory must be a path inside the prepared worktree.`,
				)
			const directory = await realpath(
				path.resolve(prepared.cwd, result.candidateDirectory),
			)
			const relative = path.relative(await realpath(prepared.root), directory)
			if (path.isAbsolute(relative) || relative.split(path.sep).includes(`..`))
				throw new Error(
					`candidateDirectory must be inside the prepared worktree.`,
				)
			prepared.candidateDirectory = directory
		}
		return
	}
	if (
		object(result) &&
		result.status === `incompatible` &&
		typeof result.reason === `string` &&
		result.reason.trim()
	)
		return result.reason
	throw new Error(
		`Preparation result must declare status "ready" or "incompatible" with a reason; omit the file for a ready environment.`,
	)
}

async function resolvePackage(
	name: string,
	directory: string,
): Promise<string | null> {
	const require = createRequire(path.join(directory, `package.json`))
	let filename: string
	try {
		filename = require.resolve(`${name}/package.json`)
	} catch {
		try {
			filename = require.resolve(name)
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === `MODULE_NOT_FOUND`) {
				// An installed package with no resolvable entry is not absent.
				if (
					(require.resolve.paths(name) ?? []).some((location) =>
						existsSync(path.join(location, name)),
					)
				)
					throw new Error(
						`Cannot resolve installed peer ${name}; supply verifyCommand using the test runner's resolver.`,
					)
				return null
			}
			throw error
		}
	}
	let current = path.dirname(await realpath(filename))
	for (;;) {
		const manifest = path.join(current, `package.json`)
		if (existsSync(manifest)) {
			const value: unknown = JSON.parse(await readFile(manifest, `utf8`))
			if (object(value) && value.name === name) return current
		}
		const parent = path.dirname(current)
		if (parent === current)
			throw new Error(`Cannot locate the manifest for peer ${name}.`)
		current = parent
	}
}

async function describePackage(
	name: string,
	directory: string,
): Promise<unknown> {
	const identity = await resolvePackage(name, directory)
	if (identity === null) return null
	const actual: unknown = JSON.parse(
		await readFile(path.join(identity, `package.json`), `utf8`),
	)
	if (!object(actual)) throw new Error(`Invalid peer manifest for ${name}.`)
	return { name: actual.name, version: actual.version, identity }
}

export async function verifyRepository(
	config: PeerConfig,
	entry: PeerEnvironment,
	prepared: PreparedPeerEnvironment,
): Promise<void> {
	let bindings: unknown
	if (config.verifyCommand) {
		// Recreate the report on every verification, including after tests.
		await writeFile(prepared.verifyFile, `null`)
		const result = await command(
			config.verifyCommand,
			prepared.cwd,
			prepared.env,
		)
		if (!result.success)
			throw new Error(
				`Peer verification failed: ${result.stderr || result.stdout}`,
			)
		bindings = JSON.parse(await readFile(prepared.verifyFile, `utf8`))
	} else {
		bindings = Object.fromEntries(
			await Promise.all(
				Object.keys(entry.peers).map(async (peer) => [
					peer,
					{
						tests: await describePackage(peer, prepared.cwd),
						candidate: await describePackage(peer, prepared.candidateDirectory),
					},
				]),
			),
		)
	}
	if (!object(bindings))
		throw new Error(`Verification must report peer resolution paths.`)
	for (const [peer, version] of Object.entries(entry.peers)) {
		const binding = bindings[peer]
		if (!object(binding))
			throw new Error(`Missing verification for peer ${peer}.`)
		if (version === null) {
			if (binding.tests !== null || binding.candidate !== null)
				throw new Error(
					`Optional peer ${peer} must be absent in ${entry.name}.`,
				)
			continue
		}
		if (!object(binding.tests) || !object(binding.candidate))
			throw new Error(`Peer ${peer}@${version} is missing after preparation.`)
		for (const actual of [binding.tests, binding.candidate]) {
			if (actual.name !== peer || actual.version !== version)
				throw new Error(
					`Peer ${peer} did not resolve to the selected version ${version}.`,
				)
			if (typeof actual.identity !== `string` || !actual.identity)
				throw new Error(`Missing module identity for peer ${peer}.`)
		}
		if (binding.tests.identity !== binding.candidate.identity)
			throw new Error(
				`Peer ${peer} resolves to different package instances in the tests and candidate.`,
			)
	}
}
