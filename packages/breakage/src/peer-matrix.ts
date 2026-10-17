import { exec } from "node:child_process"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { valid } from "semver"
import { simpleGit } from "simple-git"

export type PeerCase = { name: string; peers: Record<string, string> }
export type PeerConfig = { cases: PeerCase[]; setupCommand?: string }
export type PeerCaseResult = PeerCase & {
	status: `passed` | `setup-failed` | `contract-failed`
	stdout: string
	stderr: string
}
export type PeerMatrixOutcome = {
	gitWasClean: true
	lastReleaseFound: true
	lastReleaseTag: string
	testsWereFound: true
	testsFound: string[]
	peerCheck: true
	success: boolean
	candidateCommit: string
	contractCommit: string
	peerResults: PeerCaseResult[]
	summary: string
}

export type PeerContext = {
	baseDirname: string
	releaseCommit: string
	releaseTag: string
	testFiles: string[]
	testCommand: string
	peerConfig: string
}

export function object(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === `object` && !Array.isArray(value)
}

export async function readPeerConfig(filename: string): Promise<PeerConfig> {
	const value: unknown = JSON.parse(await readFile(filename, `utf8`))
	if (
		!object(value) ||
		!Array.isArray(value.cases) ||
		value.cases.length === 0
	) {
		throw new Error(`Peer configuration must contain a nonempty cases array.`)
	}
	const names = new Set<string>()
	for (const entry of value.cases) {
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
			if (!name || typeof version !== `string` || valid(version) !== version)
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
	return value as PeerConfig
}

export async function command(
	commandText: string,
	cwd: string,
	env: NodeJS.ProcessEnv = process.env,
): Promise<{ success: boolean; stdout: string; stderr: string }> {
	return new Promise((resolve) => {
		exec(
			commandText,
			{ cwd, env, maxBuffer: 16 * 1024 * 1024 },
			(error, stdout, stderr) => {
				resolve({
					success: error === null,
					stdout,
					stderr: stderr || (error?.message ?? ``),
				})
			},
		)
	})
}

export async function checkPeerMatrix(
	context: PeerContext,
): Promise<PeerMatrixOutcome> {
	const config = await readPeerConfig(
		path.resolve(context.baseDirname, context.peerConfig),
	)
	const git = simpleGit(context.baseDirname)
	const root = await git.revparse([`--show-toplevel`])
	const prefix = await git.revparse([`--show-prefix`])
	const candidateCommit = await git.revparse([`HEAD`])
	const peerResults: PeerCaseResult[] = []
	for (const entry of config.cases) {
		const temporary = await mkdtemp(path.join(tmpdir(), `breakage-peer-`))
		try {
			const checkout = path.join(temporary, `checkout`)
			await simpleGit().clone(root, checkout, [`--no-hardlinks`, `--quiet`])
			const clone = simpleGit(checkout)
			await clone.checkout(candidateCommit)
			await clone.raw([
				`restore`,
				`--source=${context.releaseCommit}`,
				`--worktree`,
				`--`,
				...context.testFiles.map((file) => `${prefix}${file}`),
			])
			const cwd = path.join(checkout, prefix)
			const env = {
				...process.env,
				BREAKAGE_CASE: entry.name,
				BREAKAGE_PEERS: JSON.stringify(entry.peers),
				BREAKAGE_CANDIDATE_COMMIT: candidateCommit,
				BREAKAGE_CONTRACT_COMMIT: context.releaseCommit,
			}
			if (config.setupCommand) {
				const setup = await command(config.setupCommand, cwd, env)
				if (!setup.success) {
					peerResults.push({
						...entry,
						status: `setup-failed`,
						stdout: setup.stdout,
						stderr: setup.stderr,
					})
					continue
				}
			}
			const result = await command(context.testCommand, cwd, env)
			peerResults.push({
				...entry,
				status: result.success ? `passed` : `contract-failed`,
				stdout: result.stdout,
				stderr: result.stderr,
			})
		} catch (error) {
			peerResults.push({
				...entry,
				status: `setup-failed`,
				stdout: ``,
				stderr: error instanceof Error ? error.message : String(error),
			})
		} finally {
			await rm(temporary, { recursive: true, force: true })
		}
	}
	const success = peerResults.every((result) => result.status === `passed`)
	return {
		gitWasClean: true,
		lastReleaseFound: true,
		lastReleaseTag: context.releaseTag,
		testsWereFound: true,
		testsFound: context.testFiles,
		peerCheck: true,
		success,
		candidateCommit,
		contractCommit: context.releaseCommit,
		peerResults,
		summary: success
			? `All peer cases passed.`
			: `Peer compatibility check failed.`,
	}
}
