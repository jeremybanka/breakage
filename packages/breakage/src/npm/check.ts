import path from "node:path"

import {
	resolveReleaseDelta,
	versionDelta,
	type ReleaseDeltaContext,
	type VersionTransition,
} from "../release.ts"
import { command, errorMessage } from "../task.ts"
import { validateConfig, validatePeerRanges } from "./config.ts"
import {
	checkCandidatePeers,
	discover,
	maySelectEnvironment,
	prepareEnvironment,
	stageCandidate,
	verifyResolution,
	withStage,
} from "./environment.ts"
import type { Manifest } from "./manifest.ts"
import {
	eras,
	matches,
	normalizeWorkspacePeers,
	readManifest,
} from "./manifest.ts"
import { releaseVersion, previousManifest, supportChanges } from "./release.ts"
import type {
	NpmConfig,
	NpmReport,
	NpmRepresentativeResult,
	NpmTestSelection,
} from "./types.ts"

async function checkSupport(
	config: NpmConfig,
	base: string,
	manifest: Manifest,
): Promise<NpmReport[`support`]> {
	try {
		const previous = await previousManifest(config, base)
		if (!previous) return { status: `first-release`, changes: [] }
		if (previous.name !== manifest.name)
			throw new Error(
				`Release baseline belongs to ${previous.name}, not ${manifest.name}.`,
			)
		const changes = supportChanges(previous, manifest)
		if (!changes.length)
			return { status: `unchanged`, previousVersion: previous.version, changes }
		const evidence = config.release
			? await resolveReleaseDelta(config.release, {
					packageName: manifest.name,
					packageDirectory: base,
					currentVersion: manifest.version,
					baseline: { version: previous.version },
				})
			: undefined
		if (evidence === undefined)
			return {
				status: `end-of-support`,
				previousVersion: previous.version,
				changes,
			}
		const release = versionDelta(
			evidence.previousVersion,
			evidence.version,
			config.release?.policy,
		)

		return {
			status: release.breaking ? `breaking-release` : `end-of-support`,
			previousVersion: previous.version,
			changes,
			release,
		}
	} catch (error) {
		return { status: `setup-error`, changes: [], error: errorMessage(error) }
	}
}

async function checkLocalReleases(
	config: NpmConfig,
	base: string,
	manifest: Manifest,
	representatives: NpmRepresentativeResult[],
): Promise<string[]> {
	const findings = await Promise.all(
		Object.entries(config.localPeers ?? {}).map(async ([peer, local]) => {
			const range = manifest.peerDependencies?.[peer]
			// A registration may be retained solely to resolve an older baseline.
			if (range === undefined) return []
			try {
				const directory = path.resolve(base, local.directory)
				const current = await readManifest(path.join(directory, `package.json`))
				if (current.name !== peer)
					throw new Error(`Local peer identity mismatch for ${peer}.`)
				const release = await releaseVersion(config, {
					packageName: peer,
					packageDirectory: directory,
					currentVersion: current.version,
				})
				if (release === undefined) return []
				if (!matches(release, range))
					return [
						`Declared support for ${peer}: ${range} does not include its planned local release ${release}. Update the peer range to include the intended version.`,
					]
				if (
					!representatives.some(
						(result) =>
							result.peers[peer]?.source === `candidate` &&
							result.peers[peer]?.version === release &&
							result.suites.some((suite) => suite.peer === peer),
					)
				)
					return [
						`No coordinated representative covers planned local peer ${peer}@${release}. Enroll ${peer} with breakage.candidates and configure its relationship suite.`,
					]
				return []
			} catch (error) {
				return [
					`Cannot inspect planned local release for ${peer}: ${errorMessage(error)}`,
				]
			}
		}),
	)
	return findings.flat()
}

async function runRepresentative(
	config: NpmConfig,
	base: string,
	manifest: Manifest,
	directory: string,
	coverageOnly: boolean,
	selection?: NpmTestSelection,
	plannedSuites?: readonly string[],
): Promise<NpmRepresentativeResult> {
	const label = path.relative(base, directory).split(path.sep).join(`/`)
	const result: NpmRepresentativeResult = {
		path: label,
		status: `skipped`,
		peers: {},
		suites: [],
		warnings: [],
	}
	if (
		selection &&
		`representative` in selection &&
		path.resolve(base, selection.representative) !== directory
	)
		return result
	try {
		if (
			selection &&
			`peer` in selection &&
			!(await maySelectEnvironment(
				config,
				base,
				directory,
				manifest,
				selection,
			))
		)
			return result
		return await withStage(directory, async (stage) => {
			const environment = await prepareEnvironment(
				config,
				base,
				directory,
				stage,
				manifest,
			)
			result.peers = environment.peers
			for (const peer of Object.keys(manifest.peerDependencies ?? {})) {
				if (
					!result.peers[peer] &&
					!manifest.peerDependenciesMeta?.[peer]?.optional
				)
					throw new Error(
						`Complete representative is missing required peer ${peer}.`,
					)
			}
			for (const [peer, evidence] of Object.entries(result.peers)) {
				const range = manifest.peerDependencies?.[peer]
				if (range !== undefined && !matches(evidence.version, range))
					result.warnings.push(
						`${peer}@${evidence.version} is outside declared support.`,
					)
			}
			if (
				selection &&
				`peer` in selection &&
				(!result.peers[selection.peer] ||
					!matches(result.peers[selection.peer]!.version, selection.range))
			)
				return result
			const peers = Object.keys(config.suites).filter((peer) => {
				const evidence = result.peers[peer]
				if (!evidence) return false
				if (plannedSuites !== undefined) return plannedSuites.includes(peer)
				if (selection && `peer` in selection) return peer === selection.peer
				if (selection && `representative` in selection) return true
				return matches(evidence.version, manifest.peerDependencies![peer]!)
			})
			result.suites = peers.map((peer) => ({ peer, status: `not-run` }))
			if (!peers.length) return result
			result.warnings.push(...checkCandidatePeers(environment, !!selection))
			if (coverageOnly) {
				result.status = `audited`
				return result
			}
			await stageCandidate(
				config,
				base,
				manifest,
				environment,
				peers.map((peer) => config.suites[peer]!),
			)
			for (const suite of result.suites) {
				try {
					await verifyResolution(manifest, environment)
					const execution = await command(
						config.suites[suite.peer]!.command,
						stage,
					)
					await verifyResolution(manifest, environment)
					suite.status =
						execution.code === 0
							? `passed`
							: execution.code === 1
								? `compatibility-failure`
								: `setup-error`
					if (execution.output) suite.output = execution.output
				} catch (error) {
					suite.status = `setup-error`
					suite.output = errorMessage(error)
				}
			}
			result.status = result.suites.some(
				(suite) => suite.status === `setup-error`,
			)
				? `setup-error`
				: result.suites.some(
							(suite) => suite.status === `compatibility-failure`,
					  )
					? `compatibility-failure`
					: `passed`
			return result
		})
	} catch (error) {
		result.status = `setup-error`
		result.error = errorMessage(error)
		return result
	}
}

async function run(
	config: NpmConfig,
	baseDirectory: string,
	coverageOnly: boolean,
	selection?: NpmTestSelection,
	plannedSuites?: readonly string[],
): Promise<NpmReport> {
	const report: NpmReport = {
		package: { name: `(unresolved)`, version: `(unresolved)` },
		mode: selection ? `test` : coverageOnly ? `coverage-only` : `check`,
		exitCode: 0,
		representatives: [],
		coverage: [],
		support: { status: `not-checked`, changes: [] },
		errors: [],
	}
	try {
		validateConfig(config)
		const base = path.resolve(baseDirectory, config.packageDirectory ?? `.`)
		const manifest = await normalizeWorkspacePeers(
			await readManifest(path.join(base, `package.json`)),
		)
		report.package = { name: manifest.name, version: manifest.version }
		validatePeerRanges(manifest.peerDependencies ?? {})
		for (const peer of Object.keys(config.suites)) {
			if (!manifest.peerDependencies?.[peer])
				throw new Error(`Suite ${peer} has no peerDependencies declaration.`)
		}
		for (const peer of Object.keys(config.localPeers ?? {})) {
			if (manifest.peerDependencies?.[peer] && !config.suites[peer])
				throw new Error(
					`Declared local peer ${peer} needs a relationship suite.`,
				)
		}
		if (selection && `peer` in selection) {
			if (!config.suites[selection.peer])
				throw new Error(
					`No relationship suite configured for ${selection.peer}.`,
				)
			eras(selection.range)
		}
		// One piece of release evidence per package and baseline per invocation, including failures.
		const releases = new Map<string, Promise<VersionTransition | undefined>>()
		const resolveDelta = (
			context: ReleaseDeltaContext,
		): Promise<VersionTransition | undefined> => {
			const key = JSON.stringify([
				context.packageDirectory,
				context.currentVersion,
				context.baseline,
			])
			let pending = releases.get(key)
			if (!pending) {
				pending = resolveReleaseDelta(config.release!, context)
				releases.set(key, pending)
			}
			return pending
		}
		const effective: NpmConfig = {
			...config,
			...(config.release
				? { release: { ...config.release, resolveDelta } }
				: {}),
		}

		const directories = await discover(config, base)
		const [support, representatives] = await Promise.all([
			selection
				? Promise.resolve(report.support)
				: checkSupport(effective, base, manifest),
			Promise.all(
				directories.map((directory) =>
					runRepresentative(
						effective,
						base,
						manifest,
						directory,
						coverageOnly,
						selection,
						plannedSuites,
					),
				),
			),
		])
		report.support = support
		report.representatives = representatives
		if (!selection) {
			report.errors.push(
				...(await checkLocalReleases(
					effective,
					base,
					manifest,
					representatives,
				)),
			)
			for (const peer of Object.keys(config.suites)) {
				for (const era of eras(manifest.peerDependencies![peer]!)) {
					const matching = representatives
						.filter(
							(representative) =>
								representative.peers[peer] &&
								matches(representative.peers[peer]!.version, era),
						)
						.map((representative) => representative.path)
					report.coverage.push({ peer, era, representatives: matching })
					if (!matching.length)
						report.errors.push(`No representative covers ${peer}: ${era}.`)
				}
			}
		} else if (
			!representatives.some(
				(representative) => representative.suites.length > 0,
			)
		) {
			report.errors.push(
				`No representative matched the requested test selection.`,
			)
		}
		if (
			support.status === `setup-error` ||
			report.errors.length ||
			representatives.some((result) => result.status === `setup-error`)
		)
			report.exitCode = 2
		else if (
			support.status === `end-of-support` ||
			representatives.some(
				(result) => result.status === `compatibility-failure`,
			)
		)
			report.exitCode = 1
	} catch (error) {
		report.errors.push(errorMessage(error))
		report.exitCode = 2
	}
	return report
}

export async function npmCheck(
	config: NpmConfig,
	options: { baseDirectory?: string; coverageOnly?: boolean } = {},
): Promise<NpmReport> {
	return await run(
		config,
		options.baseDirectory ?? process.cwd(),
		options.coverageOnly ?? false,
	)
}

export async function npmTest(
	config: NpmConfig,
	selection: NpmTestSelection,
	options: { baseDirectory?: string } = {},
): Promise<NpmReport> {
	return await run(
		config,
		options.baseDirectory ?? process.cwd(),
		false,
		selection,
	)
}

/** Internal matrix entrypoint: keep the full config for validation and peer identity checks. */
export async function npmTestPlanned(
	config: NpmConfig,
	selection: { representative: string; suites: readonly string[] },
	options: { baseDirectory?: string } = {},
): Promise<NpmReport> {
	return await run(
		config,
		options.baseDirectory ?? process.cwd(),
		false,
		{ representative: selection.representative },
		selection.suites,
	)
}

export function formatNpmReport(report: NpmReport): string {
	const lines = [
		`${report.package.name}@${report.package.version} — npm ${report.mode}`,
	]
	for (const result of report.representatives) {
		lines.push(`${result.path}: ${result.status}`)
		for (const [peer, evidence] of Object.entries(result.peers)) {
			lines.push(
				`  ${peer}@${evidence.version}${evidence.source === `candidate` ? ` (conditional on publication)` : ` (installed)`}`,
			)
		}
		for (const suite of result.suites) {
			lines.push(`  ${suite.peer}: ${suite.status}`)
			if (suite.status !== `passed` && suite.output) lines.push(suite.output)
		}
		for (const warning of result.warnings) lines.push(`  Warning: ${warning}`)
		if (result.error) lines.push(`  ${result.error}`)
	}
	lines.push(`Support: ${report.support.status}`)
	for (const change of report.support.changes)
		lines.push(
			`  ${change.peer}: ${change.previous ?? `(unrestricted)`} → ${change.current ?? `(unrestricted)`} (${change.reason})`,
		)
	if (report.support.release)
		lines.push(
			`  Intended release: ${report.support.release.version} (${report.support.release.delta})`,
		)
	if (report.support.error) lines.push(report.support.error)
	lines.push(...report.errors)
	if (report.mode === `coverage-only`)
		lines.push(
			`Coverage audit only; compatibility assertions were not executed.`,
		)
	return `${lines.join(`\n`)}\n`
}
