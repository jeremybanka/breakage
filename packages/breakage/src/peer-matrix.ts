import { readPeerConfig } from "./peer-config.ts"
import type { PeerCase } from "./peer-config.ts"
export type { PeerCase, PeerConfig } from "./peer-config.ts"
import { exec } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

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
		if (
			!supports(proposedSupport, entry.peers, config.prereleases === `include`)
		) {
			peerResults.push({
				...entry,
				status: `setup-failed`,
				stdout: ``,
				stderr: `Case ${entry.name} selects a peer outside the proposed support ranges.`,
			})
			continue
		}
		const contract = supports(
			releasedSupport,
			entry.peers,
			config.prereleases === `include`,
		)
			? `released`
			: `current`
		const temporary = await mkdtemp(path.join(tmpdir(), `breakage-peer-`))
		try {
			const checkout = path.join(temporary, `checkout`)
			await simpleGit().clone(root, checkout, [`--no-local`, `--quiet`])
			const clone = simpleGit(checkout)
			await clone.checkout(candidateCommit)
			// A prelude fetch by SHA need not leave a local ref for clone to copy.
			await clone.fetch([
				root,
				context.releaseCommit,
				`--no-tags`,
				`--no-write-fetch-head`,
			])
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
