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

import {
	compare,
	major,
	minor,
	prerelease,
	Range,
	satisfies,
	valid,
} from "semver"
import { simpleGit } from "simple-git"

import {
	installPeerEnvironment,
	preparePeerInstall,
	runFile,
} from "./peer-install.ts"
import { object, readPeerConfig } from "./peer-matrix.ts"
import type { PeerCase, PeerConfig } from "./peer-matrix.ts"
import { readPeerSupport } from "./peer-support.ts"
import type { PeerSupport } from "./peer-support.ts"

export type PeerInstallation = {
	candidate: string
	manifest: string
	lockfile: string
	artifacts: { filename: string; file: string; integrity: string }[]
}
export type PeerPlan = {
	version: 1
	configHash: string
	candidateCommit: string
	cases: PeerCase[]
	packageManager?: string
	installations?: Record<string, PeerInstallation>
}

export function digest(value: string | Uint8Array): string {
	return createHash(`sha256`).update(value).digest(`hex`)
}

export function selectPeerVersions(
	range: string,
	published: string[],
): string[] {
	const selected = new Set<string>()
	for (const comparators of new Range(range).set) {
		const segment =
			comparators.map((comparator) => comparator.value).join(` `) || `*`
		const versions = published
			.filter(
				(version) =>
					valid(version) === version &&
					!prerelease(version) &&
					satisfies(version, segment),
			)
			.sort(compare)
		if (!versions.length)
			throw new Error(`No published stable peer versions satisfy ${segment}.`)
		const lines = new Map<string, string[]>()
		for (const version of versions) {
			const line =
				major(version) === 0 ? `0.${minor(version)}` : String(major(version))
			const values = lines.get(line) ?? []
			values.push(version)
			lines.set(line, values)
		}
		for (const versions of lines.values()) {
			selected.add(versions[0]!)
			selected.add(versions[versions.length - 1]!)
		}
	}
	return [...selected].sort(compare)
}

export async function resolvePeerCases(
	config: PeerConfig,
	support: PeerSupport,
	cwd: string,
): Promise<PeerCase[]> {
	const cases = [...(config.cases ?? [])]
	if (config.resolve) {
		const names = Object.keys(support.ranges).sort()
		if (names.length !== 1)
			throw new Error(
				`Automatic selection currently requires exactly one declared peer.`,
			)
		const name = names[0]!
		const local = Object.keys(config.sources ?? {})
			.filter((key) => key.startsWith(`${name}@`))
			.map((key) => key.slice(name.length + 1))
		const published: unknown = local.length
			? local
			: JSON.parse(
					await runFile(`pnpm`, [`view`, name, `versions`, `--json`], cwd),
				)
		if (
			!Array.isArray(published) ||
			published.some((version) => typeof version !== `string`)
		)
			throw new Error(`Invalid published version list for ${name}.`)
		for (const version of selectPeerVersions(
			support.ranges[name]!,
			published as string[],
		))
			cases.push({ name: `${name}@${version}`, peers: { [name]: version } })
	}
	const unique = new Map<string, PeerCase>()
	for (const entry of cases) {
		const key = JSON.stringify(
			Object.entries(entry.peers).sort(([a], [b]) => a.localeCompare(b)),
		)
		if (!unique.has(key)) unique.set(key, entry)
	}
	const result = [...unique.values()]
	if (
		!result.length ||
		new Set(result.map((entry) => entry.name)).size !== result.length
	)
		throw new Error(
			`Resolved peer cases must have unique names and cannot be empty.`,
		)
	return result
}

export async function preparePeerPlan(
	baseDirname: string,
	peerConfig: string,
	artifactDirectory: string,
): Promise<PeerPlan> {
	const config = await readPeerConfig(path.resolve(baseDirname, peerConfig))
	const git = simpleGit(baseDirname)
	const candidateCommit = await git.revparse([`HEAD`])
	const support = await readPeerSupport(
		git,
		candidateCommit,
		config.manifest ?? `package.json`,
	)
	const cases = await resolvePeerCases(config, support, baseDirname)
	const plan: PeerPlan = {
		version: 1,
		configHash: digest(JSON.stringify(config)),
		candidateCommit,
		cases,
	}
	if (config.install) {
		plan.packageManager = await runFile(`pnpm`, [`--version`], baseDirname)
		plan.installations = Object.create(null) as Record<string, PeerInstallation>
		await mkdir(artifactDirectory, { recursive: true })
		for (const entry of cases) {
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
				await installPeerEnvironment(temporary, false, true)
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
					artifacts,
				}
			} finally {
				await rm(temporary, { recursive: true, force: true })
			}
		}
	}
	return plan
}

export function isPeerPlan(value: unknown): value is PeerPlan {
	if (
		!object(value) ||
		value.version !== 1 ||
		typeof value.configHash !== `string` ||
		!/^[a-f0-9]{64}$/.test(value.configHash) ||
		typeof value.candidateCommit !== `string` ||
		!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(value.candidateCommit) ||
		!Array.isArray(value.cases) ||
		!value.cases.length
	)
		return false
	if (
		value.cases.some(
			(entry) =>
				!object(entry) ||
				typeof entry.name !== `string` ||
				!object(entry.peers) ||
				Object.values(entry.peers).some(
					(version) =>
						typeof version !== `string` || valid(version) !== version,
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
}
