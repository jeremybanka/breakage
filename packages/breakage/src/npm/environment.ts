import { randomUUID } from "node:crypto"
import * as fs from "node:fs/promises"
import {
	copyFile,
	lstat,
	mkdir,
	readFile,
	realpath,
	rename,
	rm,
	writeFile,
} from "node:fs/promises"
import { createRequire } from "node:module"
import path from "node:path"

import semver from "semver"
import { simpleGit } from "simple-git"

import { prepare } from "./command.ts"
import { validatePeerRanges } from "./config.ts"
import type { Manifest } from "./manifest.ts"
import { normalizeWorkspacePeers, readManifest } from "./manifest.ts"
import { intent } from "./release.ts"
import type { NpmConfig, NpmPeerEvidence, NpmSuite } from "./types.ts"

export type Environment = {
	directory: string
	stage: string
	manifest: Manifest
	peers: Record<string, NpmPeerEvidence>
	candidates: Record<
		string,
		{
			directory: string
			artifact: string
			currentVersion: string
			version: string
			manifest: Manifest
		}
	>
}

export function within(parent: string, child: string): boolean {
	const relative = path.relative(parent, child)
	return (
		relative === `` ||
		(!relative.startsWith(`..${path.sep}`) &&
			relative !== `..` &&
			!path.isAbsolute(relative))
	)
}

async function exists(filename: string): Promise<boolean> {
	try {
		await lstat(filename)
		return true
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === `ENOENT`) return false
		throw error
	}
}

export async function discover(
	config: NpmConfig,
	base: string,
): Promise<string[]> {
	const found = new Set<string>()
	for await (const name of fs.glob(config.representatives, {
		cwd: base,
		exclude: [`**/node_modules/**`, `**/test/**`, `**/.git/**`],
	})) {
		const directory = path.resolve(base, name)
		if (!(await lstat(directory)).isDirectory())
			throw new Error(`Representative is not a directory: ${name}.`)
		found.add(directory)
	}
	if (!found.size)
		throw new Error(
			`No representative directories matched the configured globs.`,
		)
	return [...found].sort()
}

/** A freshly created ignored stage is also the exclusive ownership lock. */
export async function withStage<T>(
	directory: string,
	action: (stage: string) => Promise<T>,
): Promise<T> {
	const stage = path.join(directory, `test`)
	const git = simpleGit(directory)
	const root = await git.revparse([`--show-toplevel`])
	if (!within(await realpath(root), await realpath(directory)))
		throw new Error(`Representative escapes the repository: ${directory}.`)
	if (
		!(await git.raw([`check-ignore`, `--`, `${stage}/`])).trim() ||
		(await git.raw([`ls-files`, `--`, stage])).trim()
	) {
		throw new Error(
			`Representative test/ must be gitignored and contain no tracked files: ${stage}.`,
		)
	}
	try {
		await mkdir(stage)
	} catch (cause) {
		throw new Error(
			`Cannot own ${stage}; another run or preexisting files may be present. Remove it only after checking ownership.`,
			{ cause },
		)
	}
	try {
		return await action(stage)
	} finally {
		await rm(stage, { recursive: true, force: true })
	}
}

async function installed(
	directory: string,
	peer: string,
): Promise<NpmPeerEvidence> {
	const location = path.join(directory, `node_modules`, peer)
	const physical = await realpath(location)
	// Support pnpm's store links, while rejecting arbitrary workspace source links.
	if (!physical.split(path.sep).includes(`node_modules`))
		throw new Error(`Peer ${peer} resolves to workspace source: ${physical}.`)
	const manifest = await readManifest(path.join(physical, `package.json`))
	if (manifest.name !== peer)
		throw new Error(`Expected ${peer}, found ${manifest.name} in ${location}.`)
	return { version: manifest.version, path: physical, source: `installed` }
}

export async function prepareEnvironment(
	config: NpmConfig,
	base: string,
	directory: string,
	stage: string,
	packageManifest: Manifest,
): Promise<Environment> {
	const peerNames = Object.keys(packageManifest.peerDependencies ?? {})
	const filename = path.join(directory, `package.json`)
	const lockfile = path.join(directory, config.lockfile)
	for (const input of [filename, lockfile]) {
		if (
			!(await lstat(input)).isFile() ||
			!within(directory, await realpath(input))
		)
			throw new Error(
				`Installation inputs must be regular files inside the representative: ${input}.`,
			)
	}
	const inputs = await Promise.all([readFile(filename), readFile(lockfile)])
	const manifest = await readManifest(filename)
	// npm lets optionalDependencies override dependencies of the same name.
	const declarations = {
		...manifest.devDependencies,
		...manifest.dependencies,
		...manifest.optionalDependencies,
	}
	const candidates: Environment[`candidates`] = {}
	for (const peer of manifest.breakage?.candidates ?? []) {
		if (!peerNames.includes(peer))
			throw new Error(
				`Candidate ${peer} is not a declared peer of the package under test.`,
			)
		const local = config.localPeers?.[peer]
		if (!local)
			throw new Error(`Candidate ${peer} has no localPeers configuration.`)
		const localDirectory = path.resolve(base, local.directory)
		const localManifest = await normalizeWorkspacePeers(
			await readManifest(path.join(localDirectory, `package.json`)),
		)
		if (localManifest.name !== peer)
			throw new Error(`Local peer identity mismatch for ${peer}.`)
		validatePeerRanges(localManifest.peerDependencies ?? {})
		const evidence = await intent(config, {
			packageName: peer,
			packageDirectory: localDirectory,
			currentVersion: localManifest.version,
		})
		if (evidence.status === `none`)
			throw new Error(`Candidate ${peer} has no certified release intent.`)
		candidates[peer] = {
			directory: localDirectory,
			artifact: path.resolve(base, local.artifact),
			currentVersion: localManifest.version,
			version: evidence.version,
			manifest: localManifest,
		}
	}
	const relevant = [
		...new Set([
			...peerNames,
			...Object.values(candidates).flatMap((candidate) =>
				Object.keys(candidate.manifest.peerDependencies ?? {}),
			),
		]),
	].filter(
		(peer) =>
			peer === packageManifest.name ||
			declarations[peer] !== undefined ||
			candidates[peer] !== undefined,
	)
	const before: Record<string, string> = {}
	for (const peer of relevant) {
		if (
			peer !== packageManifest.name &&
			!candidates[peer] &&
			(await exists(path.join(directory, `node_modules`, peer)))
		)
			before[peer] = (await installed(directory, peer)).version
	}
	const preparation = await prepare(config.prepareCommand, directory).then(
		() => ({ ok: true as const }),
		(error: unknown) => ({ ok: false as const, error }),
	)
	const after = await Promise.all(
		[filename, lockfile].map((input) =>
			readFile(input).catch(() => Buffer.alloc(0)),
		),
	)
	if (inputs.some((input, index) => !input.equals(after[index]!))) {
		await Promise.all(
			[filename, lockfile].map(async (input, index) => {
				// Recreate an input rather than writing through a link introduced by a command.
				await rm(input, { force: true })
				await writeFile(input, inputs[index]!, { flag: `wx` })
			}),
		)
		throw new Error(
			`Frozen preparation changed the manifest or lockfile in ${directory}; restored the original inputs.`,
			{ cause: preparation.ok ? undefined : preparation.error },
		)
	}
	if (!preparation.ok) throw preparation.error
	const peers: Environment[`peers`] = {}
	for (const peer of relevant) {
		const candidate = candidates[peer]
		const staged = candidate !== undefined || peer === packageManifest.name
		if (
			!staged &&
			Object.hasOwn(manifest.optionalDependencies ?? {}, peer) &&
			!(await exists(path.join(directory, `node_modules`, peer)))
		)
			continue
		const evidence: NpmPeerEvidence = staged
			? {
					version: candidate?.version ?? packageManifest.version,
					path: path.join(stage, `node_modules`, peer),
					source: `candidate`,
				}
			: await installed(directory, peer)
		const specifier = declarations[peer]
		if (
			!(staged && specifier === undefined) &&
			(!specifier ||
				!semver.validRange(specifier) ||
				!semver.satisfies(evidence.version, specifier, {
					includePrerelease: true,
				}))
		) {
			throw new Error(
				`Representative ${peer}@${evidence.version} does not match its manifest constraint ${specifier ?? `(missing)`}.`,
			)
		}
		if (before[peer] && before[peer] !== evidence.version)
			throw new Error(
				`Stale installed ${peer}: frozen preparation changed ${before[peer]} to ${evidence.version}.`,
			)
		for (const [localPeer, local] of Object.entries(config.localPeers ?? {})) {
			if (staged) continue
			const localDirectory = path.resolve(base, local.directory)
			// Historical-only registrations need not exist in today's checkout.
			if (
				!peerNames.includes(localPeer) &&
				!relevant.includes(localPeer) &&
				!(await exists(localDirectory))
			)
				continue
			if (within(await realpath(localDirectory), evidence.path))
				throw new Error(
					`Released peer ${peer} resolves into a local workspace package.`,
				)
		}
		peers[peer] = evidence
	}
	return { directory, stage, manifest, peers, candidates }
}

/** Validate the complete coordinated formulation before an audit or execution. */
export function checkCandidatePeers(
	environment: Environment,
	focused: boolean,
): string[] {
	const conflicts: string[] = []
	for (const [name, candidate] of Object.entries(environment.candidates)) {
		for (const [peer, range] of Object.entries(
			candidate.manifest.peerDependencies ?? {},
		)) {
			const evidence = environment.peers[peer]
			if (!evidence) {
				if (candidate.manifest.peerDependenciesMeta?.[peer]?.optional) continue
				throw new Error(
					`Complete representative is missing required peer ${peer}: ${range} of coordinated candidate ${name}@${candidate.version}.`,
				)
			}
			// This is declaration membership; exact-preview coverage is audited separately.
			if (!semver.satisfies(evidence.version, range))
				conflicts.push(
					`Coordinated candidate ${name}@${candidate.version} requires ${peer}: ${range}, but the representative provides ${peer}@${evidence.version}.`,
				)
		}
	}
	if (conflicts.length && !focused) throw new Error(conflicts.join(`\n`))
	return conflicts.map(
		(conflict) =>
			`${conflict} Running focused exploration outside declared support.`,
	)
}

async function copySuite(
	base: string,
	stage: string,
	suite: NpmSuite,
): Promise<void> {
	for (const pattern of suite.files) {
		if (path.isAbsolute(pattern) || pattern.split(/[\\/]/).includes(`..`))
			throw new Error(`Suite pattern must stay inside the package: ${pattern}.`)
		let count = 0
		for await (const filename of fs.glob(pattern, {
			cwd: base,
			exclude: [
				`**/node_modules/**`,
				`**/.git/**`,
				path.relative(base, stage),
				`${path.relative(base, stage)}/**`,
			],
		})) {
			const source = path.resolve(base, filename)
			const stat = await lstat(source)
			if (stat.isDirectory()) continue
			if (
				!stat.isFile() ||
				!within(await realpath(base), await realpath(source))
			)
				throw new Error(
					`Suite inputs must be regular package files: ${filename}.`,
				)
			// Refuse a symlink anywhere in the source path, even if its target is internal.
			let segment = base
			for (const part of filename.split(path.sep)) {
				segment = path.join(segment, part)
				if ((await lstat(segment)).isSymbolicLink())
					throw new Error(`Suite inputs cannot follow symlinks: ${filename}.`)
			}
			if (
				[
					`package.json`,
					`package-lock.json`,
					`npm-shrinkwrap.json`,
					`.npmrc`,
				].includes(filename) ||
				filename.split(path.sep).includes(`node_modules`)
			) {
				throw new Error(
					`Suite input collides with the consumer installation: ${filename}.`,
				)
			}
			const destination = path.resolve(stage, filename)
			if (!within(stage, destination))
				throw new Error(`Suite path escapes its stage: ${filename}.`)
			await mkdir(path.dirname(destination), { recursive: true })
			await copyFile(source, destination)
			count++
		}
		if (!count) throw new Error(`Suite pattern matched no files: ${pattern}.`)
	}
}

async function findPackage(
	from: string,
	name: string,
): Promise<string | undefined> {
	const lookup =
		createRequire(path.join(from, `__breakage_probe__.ts`)).resolve.paths(
			name,
		) ?? []
	for (const directory of lookup) {
		const location = path.join(directory, name)
		// An installed but broken package must fail verification, not look absent.
		if (await exists(location)) return await realpath(location)
	}
	return undefined
}

async function resolvePackage(from: string, name: string): Promise<string> {
	const location = await findPackage(from, name)
	if (location !== undefined) return location
	throw new Error(`Cannot resolve ${name} from ${from}.`)
}

export async function stageCandidate(
	config: NpmConfig,
	base: string,
	manifest: Manifest,
	environment: Environment,
	suites: NpmSuite[],
): Promise<void> {
	const { stage, candidates } = environment
	const artifacts = {
		[manifest.name]: path.resolve(base, config.artifact),
		...Object.fromEntries(
			Object.entries(candidates).map(([name, entry]) => [name, entry.artifact]),
		),
	}
	if (candidates[manifest.name])
		throw new Error(
			`The package under test cannot also be its own candidate peer.`,
		)
	for (const artifact of Object.values(artifacts)) {
		if (!(await lstat(artifact)).isFile())
			throw new Error(`Candidate artifact must be a packed file: ${artifact}.`)
	}
	await writeFile(
		path.join(stage, `package.json`),
		JSON.stringify({
			name: `breakage-consumer`,
			version: `0.0.0`,
			private: true,
			type: environment.manifest.type ?? `module`,
			dependencies: Object.fromEntries(
				Object.entries(artifacts).map(([name, artifact]) => [
					name,
					`file:${artifact}`,
				]),
			),
		}),
	)
	await prepare(
		config.installCommand ??
			`npm install --prefix . --workspaces=false --ignore-scripts --legacy-peer-deps --package-lock=false --no-audit --no-fund`,
		stage,
	)
	for (const [name] of Object.entries(artifacts)) {
		const directory = path.join(stage, `node_modules`, name)
		if (!within(stage, await realpath(directory)))
			throw new Error(
				`Candidate ${name} must be installed inside the test stage.`,
			)
		const filename = path.join(directory, `package.json`)
		const packed = await readManifest(filename)
		const candidate = candidates[name]
		if (
			packed.name !== name ||
			(candidate
				? ![candidate.currentVersion, candidate.version].includes(
						packed.version,
					)
				: packed.version !== manifest.version)
		) {
			throw new Error(
				`Candidate archive identity/version mismatch for ${name}@${packed.version}.`,
			)
		}
		const expectedManifest = candidate?.manifest ?? manifest
		if (
			Object.keys({
				...packed.peerDependencies,
				...expectedManifest.peerDependencies,
			}).some(
				(peer) =>
					packed.peerDependencies?.[peer] !==
						expectedManifest.peerDependencies?.[peer] ||
					Boolean(packed.peerDependenciesMeta?.[peer]?.optional) !==
						Boolean(expectedManifest.peerDependenciesMeta?.[peer]?.optional),
			)
		) {
			throw new Error(
				`Candidate archive has stale peer declarations; rebuild and pack ${name}.`,
			)
		}
		if (candidate) {
			const evidence = environment.peers[name]
			if (evidence) evidence.archiveVersion = packed.version
			if (packed.version !== candidate.version) {
				// Replace the entry: installed files may share an inode with a cache.
				const raw = JSON.parse(await readFile(filename, `utf8`)) as Record<
					string,
					unknown
				>
				const temporary = path.join(
					path.dirname(filename),
					`.breakage-${randomUUID()}.json`,
				)
				await writeFile(
					temporary,
					JSON.stringify({ ...raw, version: candidate.version }),
					{ flag: `wx` },
				)
				try {
					await rename(temporary, filename)
				} finally {
					await rm(temporary, { force: true })
				}
			}
		}
	}
	for (const suite of suites) await copySuite(base, stage, suite)
	await verifyResolution(manifest, environment)
}

export async function verifyResolution(
	manifest: Manifest,
	environment: Environment,
): Promise<void> {
	const { stage, peers } = environment
	const packages = [manifest.name, ...Object.keys(environment.candidates)]
	for (const [peer, evidence] of Object.entries(peers)) {
		const expected = await realpath(evidence.path)
		if ((await resolvePackage(stage, peer)) !== expected)
			throw new Error(`Tests resolve a shadow copy of ${peer}.`)
		for (const name of packages) {
			if (name === peer) continue
			const origin = path.join(stage, `node_modules`, name)
			if ((await resolvePackage(origin, peer)) !== expected)
				throw new Error(
					`Candidate ${name} resolves a different instance of ${peer} than its tests.`,
				)
		}
		const actual = await readManifest(path.join(expected, `package.json`))
		if (actual.name !== peer || actual.version !== evidence.version)
			throw new Error(`Peer identity changed during execution: ${peer}.`)
	}
	// Runtime dependency peers can be singletons too (for example a React helper).
	const visited = new Set<string>()
	const pending = packages.map((name) => path.join(stage, `node_modules`, name))
	while (pending.length) {
		const directory = await realpath(pending.pop()!)
		if (visited.has(directory)) continue
		if (!directory.split(path.sep).includes(`node_modules`))
			throw new Error(
				`Runtime dependency resolves to workspace source: ${directory}.`,
			)
		visited.add(directory)
		const installedManifest = await readManifest(
			path.join(directory, `package.json`),
		)
		for (const peer of Object.keys(installedManifest.peerDependencies ?? {})) {
			const evidence = peers[peer]
			if (
				evidence &&
				(await resolvePackage(directory, peer)) !==
					(await realpath(evidence.path))
			)
				throw new Error(
					`Runtime dependency ${installedManifest.name} resolves a different instance of ${peer}.`,
				)
		}
		const optional = installedManifest.optionalDependencies ?? {}
		for (const dependency of Object.keys({
			...installedManifest.dependencies,
			...optional,
		})) {
			// npm lets optionalDependencies override dependencies of the same name.
			if (Object.hasOwn(optional, dependency)) {
				const location = await findPackage(directory, dependency)
				if (location !== undefined) pending.push(location)
			} else {
				pending.push(await resolvePackage(directory, dependency))
			}
		}
	}
}
