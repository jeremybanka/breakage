import { createPeerWorktree } from "./peer-worktree.ts"
import { peerSuites, validatePeerConfig } from "./peer-config.ts"
import type { PeerEnvironment, PeerConfig } from "./peer-config.ts"
export type { PeerEnvironment, PeerConfig } from "./peer-config.ts"
import { command } from "./peer-command.ts"
import {
	prepareRepository,
	preparationConflict,
	verifyRepository,
} from "./peer-preparation.ts"
import type { PreparedPeerEnvironment } from "./peer-preparation.ts"
import type { PeerSuite } from "./peer-config.ts"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { simpleGit } from "simple-git"
import { minimatch } from "minimatch"

import {
	installPeerEnvironment,
	runFile,
	verifyPeerEnvironment,
} from "./peer-install.ts"

import { readPeerSupport } from "./peer-support.ts"
import {
	digest,
	resolvePeerEnvironments,
	restorePeerInstall,
	preparePeerPlan,
	assertPeerCoverage,
} from "./peer-plan.ts"
import type { PeerPlan } from "./peer-plan.ts"

export type PeerEnvironmentResult = PeerEnvironment & {
	status: `passed` | `setup-failed` | `contract-failed`
	stdout: string
	stderr: string
	contract?: `released` | `current`
}
export type PeerMatrixOutcome = {
	gitWasClean: true
	peerCheck: true
	success: boolean
	candidateCommit: string
	contractCommit: string
	excludedEnvironments: PeerPlan[`excluded`]
	peerResults: PeerEnvironmentResult[]
	summary: string
}

export type PeerContext = {
	baseDirname: string
	peerConfig: PeerConfig
	peerPlan?: PeerPlan | undefined
}

export async function checkPeerMatrix(
	context: PeerContext,
): Promise<PeerMatrixOutcome> {
	const config = validatePeerConfig(context.peerConfig)
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
	const support = await readPeerSupport(git, candidateCommit, manifest)
	const suites = peerSuites(config, Object.keys(support.ranges))
	const environments = await resolvePeerEnvironments(
		config,
		support,
		context.baseDirname,
		suites,
	)
	if (context.peerPlan) {
		const planned = [
			...context.peerPlan.environments,
			...context.peerPlan.excluded.map(({ environment }) => environment),
		]
		const ordered = (entries: PeerEnvironment[]) =>
			JSON.stringify([...entries].sort((a, b) => a.name.localeCompare(b.name)))
		if (
			JSON.stringify(context.peerPlan.suites) !== JSON.stringify(suites) ||
			ordered(planned) !== ordered(environments)
		)
			throw new Error(
				`Peer snapshot belongs to another embassy selection. Run breakage prelude again.`,
			)
		assertPeerCoverage(
			environments,
			context.peerPlan.environments,
			suites,
			context.peerPlan.excluded,
		)
	}
	const files = (
		await git.raw([`ls-tree`, `-r`, `--name-only`, `-z`, candidateCommit])
	)
		.split(`\0`)
		.filter(Boolean)
	for (const suite of suites)
		if (!files.some((file) => minimatch(file, suite.testPattern)))
			throw new Error(
				`Embassy ${suite.name} selected no current tests with pattern ${JSON.stringify(suite.testPattern)}.`,
			)
	const artifacts = await mkdtemp(
		path.join(tmpdir(), `breakage-peer-artifacts-`),
	)
	try {
		const plan =
			context.peerPlan ??
			(await preparePeerPlan(context.baseDirname, config, artifacts))
		if (config.prepareCommand)
			return await checkRepositoryMatrix(config, context, plan, suites)
		const peerResults: PeerEnvironmentResult[] = []
		for (const entry of plan.environments) {
			const suite = suites.find((suite) => suite.name === entry.embassy)!
			const contract = `current` as const
			const worktree = await createPeerWorktree(root, candidateCommit)
			try {
				const checkout = worktree.directory
				const cwd = path.join(checkout, prefix)
				let candidate: string | undefined
				if (config.installer === `pnpm`) {
					const installation = plan.installations?.[entry.name]
					if (!installation)
						throw new Error(
							`Missing pinned peer installation. Run breakage prelude again.`,
						)
					await restorePeerInstall(installation, context.baseDirname, cwd)
					candidate = installation.candidate
					await installPeerEnvironment(cwd, true)
					await verifyPeerEnvironment(cwd, candidate, entry)
				}
				const env = {
					...process.env,
					BREAKAGE_ENVIRONMENT: entry.name,
					BREAKAGE_PEERS: JSON.stringify(entry.peers),
					BREAKAGE_CANDIDATE_COMMIT: candidateCommit,
					BREAKAGE_CONTRACT_COMMIT: candidateCommit,
					BREAKAGE_EMBASSY: suite.name,
					BREAKAGE_PEER_ALIASES: JSON.stringify(entry.aliases),
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
				const result = await command(suite.testCommand, cwd, env)
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
				await worktree.cleanup()
			}
		}
		const success = peerResults.every((entry) => entry.status === `passed`)
		return {
			gitWasClean: true,
			peerCheck: true,
			success,
			candidateCommit,
			contractCommit: candidateCommit,
			peerResults,
			excludedEnvironments: plan.excluded,
			summary: success
				? `All ${peerResults.length} peer embassy environments passed.`
				: `Peer embassy checks failed in ${peerResults.filter((entry) => entry.status !== `passed`).length} of ${peerResults.length} environments.`,
		}
	} finally {
		await rm(artifacts, { recursive: true, force: true })
	}
}

async function checkRepositoryMatrix(
	config: PeerConfig,
	context: PeerContext,
	plan: PeerPlan,
	suites: PeerSuite[],
): Promise<PeerMatrixOutcome> {
	const ready: { entry: PeerEnvironment; prepared: PreparedPeerEnvironment }[] =
		[]
	const resources: PreparedPeerEnvironment[] = []
	const failures = new Map<string, PeerEnvironmentResult>()
	const excluded = [...plan.excluded]
	try {
		for (const entry of plan.environments) {
			try {
				const prepared = await prepareRepository(
					config,
					entry,
					context.baseDirname,
					plan,
				)
				resources.push(prepared)
				const result = await command(
					config.prepareCommand!,
					prepared.cwd,
					prepared.env,
				)
				if (!result.success) {
					failures.set(entry.name, {
						...entry,
						status: `setup-failed`,
						stdout: result.stdout,
						stderr: result.stderr,
					})
					continue
				}
				const reason = await preparationConflict(prepared)
				if (reason) {
					excluded.push({ environment: entry, reason })
					continue
				}
				if (config.setupCommand) {
					const setup = await command(
						config.setupCommand,
						prepared.cwd,
						prepared.env,
					)
					if (!setup.success) {
						failures.set(entry.name, {
							...entry,
							status: `setup-failed`,
							stdout: setup.stdout,
							stderr: setup.stderr,
						})
						continue
					}
				}
				await verifyRepository(config, entry, prepared)
				ready.push({ entry, prepared })
			} catch (error) {
				failures.set(entry.name, {
					...entry,
					status: `setup-failed`,
					stdout: ``,
					stderr: error instanceof Error ? error.message : String(error),
				})
			}
		}
		// A preparation failure is inconclusive, never evidence that an era can
		// be dropped. Only explicitly incompatible combinations are excluded.
		assertPeerCoverage(
			plan.environments,
			[...ready.map(({ entry }) => entry), ...failures.values()],
			suites,
			excluded,
		)
		const results = new Map(failures)
		for (const { entry, prepared } of ready) {
			const suite = suites.find((suite) => suite.name === entry.embassy)!
			try {
				await verifyRepository(config, entry, prepared)
				const result = await command(
					suite.testCommand,
					prepared.cwd,
					prepared.env,
				)
				await verifyRepository(config, entry, prepared)
				results.set(entry.name, {
					...entry,
					contract: `current`,
					status: result.success ? `passed` : `contract-failed`,
					stdout: result.stdout,
					stderr: result.stderr,
				})
			} catch (error) {
				results.set(entry.name, {
					...entry,
					status: `setup-failed`,
					stdout: ``,
					stderr: error instanceof Error ? error.message : String(error),
				})
			}
		}
		const peerResults = plan.environments.flatMap((entry) =>
			results.has(entry.name) ? [results.get(entry.name)!] : [],
		)
		const success = peerResults.every((entry) => entry.status === `passed`)
		return {
			gitWasClean: true,
			peerCheck: true,
			success,
			candidateCommit: plan.candidateCommit,
			contractCommit: plan.candidateCommit,
			peerResults,
			excludedEnvironments: excluded,
			summary: success
				? `All ${peerResults.length} peer embassy environments passed.`
				: `Peer embassy checks failed in ${peerResults.filter((entry) => entry.status !== `passed`).length} of ${peerResults.length} environments.`,
		}
	} finally {
		await cleanupRepositories(resources)
	}
}

async function cleanupRepositories(
	resources: PreparedPeerEnvironment[],
): Promise<void> {
	const results = await Promise.allSettled(
		resources.map((resource) => resource.cleanup()),
	)
	const failures = results.filter((result) => result.status === `rejected`)
	if (failures.length)
		throw new AggregateError(
			failures.map((failure) => failure.reason),
			`Failed to remove embassy worktrees.`,
		)
}
