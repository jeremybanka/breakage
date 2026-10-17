import { exec } from "node:child_process"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { valid } from "semver"
import { simpleGit } from "simple-git"

import {
	installPeerEnvironment,
	preparePeerInstall,
	runFile,
	verifyPeerEnvironment,
} from "./peer-install.ts"

import { droppedSupport, readPeerSupport, supports } from "./peer-support.ts"
import type { PeerSupportChange } from "./peer-support.ts"
import { digest, resolvePeerCases, restorePeerInstall } from "./peer-plan.ts"
import type { PeerPlan } from "./peer-plan.ts"

export type PeerCase = { name: string; peers: Record<string, string> }
export type PeerConfig = {
	cases?: PeerCase[]
	resolve?: boolean
	setupCommand?: string
	manifest?: string
	install?: boolean
	testDependencies?: Record<string, string>
	sources?: Record<string, string>
}
export type PeerCaseResult = PeerCase & {
	status: `passed` | `setup-failed` | `contract-failed`
	stdout: string
	stderr: string
	contract?: `released` | `current`
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
	supportChanges: PeerSupportChange[]
	supportCertified: boolean
	certificationStdout: string
	certificationStderr: string
	summary: string
}

export type PeerContext = {
	baseDirname: string
	releaseCommit: string
	releaseTag: string
	testFiles: string[]
	testCommand: string
	peerConfig: string
	certifyCommand: string
	peerPlan?: PeerPlan | undefined
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
	if (value.manifest !== undefined && typeof value.manifest !== `string`)
		throw new Error(`manifest must be a string.`)
	if (value.install !== undefined && typeof value.install !== `boolean`)
		throw new Error(`install must be a boolean.`)
	if (value.resolve !== undefined && typeof value.resolve !== `boolean`)
		throw new Error(`resolve must be a boolean.`)
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
	if (
		context.peerPlan?.packageManager &&
		context.peerPlan.packageManager !==
			(await runFile(`pnpm`, [`--version`], context.baseDirname))
	)
		throw new Error(
			`Peer snapshot uses a different pnpm version. Run breakage prelude again.`,
		)
	if (
		context.peerPlan &&
		(context.peerPlan.configHash !== digest(JSON.stringify(config)) ||
			context.peerPlan.candidateCommit !== candidateCommit)
	)
		throw new Error(
			`Peer snapshot belongs to another configuration or candidate commit. Run breakage prelude again.`,
		)
	const manifest = config.manifest ?? `package.json`
	const releasedSupport = await readPeerSupport(
		git,
		context.releaseCommit,
		manifest,
	)
	const proposedSupport = await readPeerSupport(git, candidateCommit, manifest)
	const supportChanges = droppedSupport(releasedSupport, proposedSupport)
	const certification = supportChanges.length
		? await command(context.certifyCommand, context.baseDirname)
		: { success: true, stdout: ``, stderr: `` }
	const peerResults: PeerCaseResult[] = []
	const cases =
		context.peerPlan?.cases ??
		(await resolvePeerCases(config, proposedSupport, context.baseDirname))
	for (const entry of cases) {
		if (!supports(proposedSupport, entry.peers)) {
			peerResults.push({
				...entry,
				status: `setup-failed`,
				stdout: ``,
				stderr: `Case ${entry.name} selects a peer outside the proposed support ranges.`,
			})
			continue
		}
		const contract = supports(releasedSupport, entry.peers)
			? `released`
			: `current`
		const temporary = await mkdtemp(path.join(tmpdir(), `breakage-peer-`))
		try {
			const checkout = path.join(temporary, `checkout`)
			await simpleGit().clone(root, checkout, [`--no-local`, `--quiet`])
			const clone = simpleGit(checkout)
			await clone.checkout(candidateCommit)
			if (contract === `released`)
				await clone.raw([
					`restore`,
					`--source=${context.releaseCommit}`,
					`--worktree`,
					`--`,
					...context.testFiles.map((file) => `${prefix}${file}`),
				])
			const cwd = path.join(checkout, prefix)
			let candidate: string | undefined
			if (config.install) {
				const installation = context.peerPlan?.installations?.[entry.name]
				if (context.peerPlan && !installation)
					throw new Error(
						`Missing pinned peer installation. Run breakage prelude again.`,
					)
				if (installation) {
					await restorePeerInstall(installation, context.baseDirname, cwd)
					candidate = installation.candidate
				} else
					candidate = await preparePeerInstall(
						config,
						entry,
						context.baseDirname,
						cwd,
					)
				await installPeerEnvironment(cwd, installation !== undefined)
				await verifyPeerEnvironment(cwd, candidate, entry)
			}
			const env = {
				...process.env,
				BREAKAGE_CASE: entry.name,
				BREAKAGE_PEERS: JSON.stringify(entry.peers),
				BREAKAGE_CANDIDATE_COMMIT: candidateCommit,
				BREAKAGE_CONTRACT_COMMIT:
					contract === `released` ? context.releaseCommit : candidateCommit,
			}
			if (config.setupCommand) {
				const setup = await command(config.setupCommand, cwd, env)
				if (!setup.success) {
					peerResults.push({
						...entry,
						contract,
						status: `setup-failed`,
						stdout: setup.stdout,
						stderr: setup.stderr,
					})
					continue
				}
			}
			if (candidate) await verifyPeerEnvironment(cwd, candidate, entry)
			const result = await command(context.testCommand, cwd, env)
			if (candidate) await verifyPeerEnvironment(cwd, candidate, entry)
			peerResults.push({
				...entry,
				contract,
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
	const success =
		certification.success &&
		peerResults.every((result) => result.status === `passed`)
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
		supportChanges,
		supportCertified: certification.success,
		certificationStdout: certification.stdout,
		certificationStderr: certification.stderr,
		summary: success
			? `All peer cases passed.`
			: `Peer compatibility check failed.`,
	}
}
