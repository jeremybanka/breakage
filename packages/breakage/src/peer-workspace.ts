import { createPeerWorktree } from "./peer-worktree.ts"
import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import path from "node:path"

import { satisfies } from "semver"
import { minimatch } from "minimatch"
import { simpleGit } from "simple-git"

import { object } from "./peer-config.ts"
import type { PeerConfig } from "./peer-config.ts"
import { runFile } from "./peer-install.ts"
import { withDirectoryLock } from "./directory-lock.ts"

type WorkspacePackage = { file: string; name: string; version: string }

async function packages(root: string): Promise<WorkspacePackage[]> {
	if (!existsSync(path.join(root, `pnpm-workspace.yaml`))) return []
	const entries: unknown = JSON.parse(
		await runFile(
			`pnpm`,
			[`--recursive`, `list`, `--depth`, `-1`, `--json`],
			root,
		),
	)
	if (!Array.isArray(entries))
		throw new Error(`Could not discover pnpm workspace packages in ${root}.`)
	const result: WorkspacePackage[] = []
	for (const entry of entries) {
		if (
			object(entry) &&
			typeof entry.name === `string` &&
			typeof entry.version === `string` &&
			typeof entry.path === `string`
		)
			result.push({
				file: path.relative(root, path.join(entry.path, `package.json`)),
				name: entry.name,
				version: entry.version,
			})
	}
	return result
}

export type WorkspacePeerRelease = { commit: string; directory: string }

async function manifestWorkspaces(root: string): Promise<WorkspacePackage[]> {
	if (!existsSync(path.join(root, `package.json`))) return []
	const manifest: unknown = JSON.parse(
		await readFile(path.join(root, `package.json`), `utf8`),
	)
	if (!object(manifest)) return []
	const patterns = Array.isArray(manifest.workspaces)
		? manifest.workspaces
		: object(manifest.workspaces)
			? manifest.workspaces.packages
			: undefined
	if (
		!Array.isArray(patterns) ||
		!patterns.every((pattern) => typeof pattern === `string`)
	)
		return []
	const include = patterns.filter((pattern) => !pattern.startsWith(`!`))
	const exclude = patterns
		.filter((pattern) => pattern.startsWith(`!`))
		.map((pattern) => pattern.slice(1))
	const files = (await simpleGit(root).raw([`ls-files`, `-z`]))
		.split(`\0`)
		.filter(
			(file) =>
				file.endsWith(`/package.json`) &&
				include.some((pattern) =>
					minimatch(path.posix.dirname(file), pattern),
				) &&
				!exclude.some((pattern) =>
					minimatch(path.posix.dirname(file), pattern),
				),
		)
	const result: WorkspacePackage[] = []
	for (const file of files) {
		const entry: unknown = JSON.parse(
			await readFile(path.join(root, file), `utf8`),
		)
		if (
			object(entry) &&
			typeof entry.name === `string` &&
			typeof entry.version === `string`
		)
			result.push({ file, name: entry.name, version: entry.version })
	}
	return result
}

export async function resolveWorkspacePeer(
	config: PeerConfig,
	source: string,
	peer: string,
	version: string,
): Promise<WorkspacePeerRelease | undefined> {
	const sourceGit = simpleGit(source)
	const root = await sourceGit.revparse([`--show-toplevel`])
	const git = simpleGit(root)
	const configured = config.workspace?.[peer]
	const current = (
		configured
			? []
			: await (config.installer === `pnpm`
					? packages(root)
					: manifestWorkspaces(root))
	).filter((entry) => entry.name === peer)
	if (!configured && !current.length) return
	if (!configured && current.length > 1)
		throw new Error(
			`Workspace peer ${peer} matches multiple package directories. Set workspace[${JSON.stringify(peer)}].directory explicitly.`,
		)
	const directory = configured
		? path.relative(root, path.resolve(source, configured.directory))
		: path.dirname(current[0]!.file)
	if (path.isAbsolute(directory) || directory.split(path.sep).includes(`..`))
		throw new Error(
			`Workspace peer ${peer} must live inside the Git repository.`,
		)
	const file = path.posix.join(
		directory.split(path.sep).join(`/`),
		`package.json`,
	)
	const pattern = configured?.tagPattern
		? new RegExp(configured.tagPattern)
		: undefined
	const matches = (tag: string) =>
		pattern ? pattern.test(tag) : tag === `${peer}@${version}`
	const findReleases = async () => {
		const releases: { tag: string; commit: string }[] = []
		for (const tag of (await git.tags()).all.filter(matches)) {
			const commit = await git.revparse([`refs/tags/${tag}^{commit}`])
			let manifest: unknown
			try {
				manifest = JSON.parse(await git.show([`${commit}:${file}`]))
			} catch {
				continue
			}
			if (
				object(manifest) &&
				manifest.name === peer &&
				manifest.version === version
			)
				releases.push({ tag, commit })
		}
		return releases
	}
	let releases = await findReleases()
	if (
		!releases.length &&
		(await git.getRemotes()).some((remote) => remote.name === `origin`)
	) {
		const remote = (await git.listRemote([`--tags`, `origin`]))
			.split(`\n`)
			.map((line) => line.split(`\t`)[1])
			.filter(
				(ref): ref is string =>
					!!ref &&
					!ref.endsWith(`^{}`) &&
					matches(ref.replace(/^refs\/tags\//, ``)),
			)
		const local = new Set((await git.tags()).all)
		const common = await git.revparse([
			`--path-format=absolute`,
			`--git-common-dir`,
		])
		for (const ref of remote)
			if (!local.has(ref.replace(/^refs\/tags\//, ``)))
				await withDirectoryLock(path.join(common, `breakage-fetch.lock`), () =>
					git.fetch([
						`origin`,
						`${ref}:${ref}`,
						`--no-tags`,
						`--no-write-fetch-head`,
					]),
				)
		releases = await findReleases()
	}
	if (releases.length !== 1)
		throw new Error(
			`Workspace peer ${peer}@${version} needs exactly one matching release tag with that package version at ${file}; found ${releases.length}. Fetch its release tag or configure workspace[${JSON.stringify(peer)}].tagPattern.`,
		)
	return { commit: releases[0]!.commit, directory: path.posix.dirname(file) }
}

/** Materialize the pinned workspace release, never the current peer source. */
export async function packWorkspacePeer(
	config: PeerConfig,
	source: string,
	peer: string,
	version: string,
	artifacts: string,
): Promise<
	{ filename: string; overrides: Record<string, string> } | undefined
> {
	const release = await resolveWorkspacePeer(config, source, peer, version)
	if (!release) return
	const { commit, directory } = release
	const root = await simpleGit(source).revparse([`--show-toplevel`])
	const configured = config.workspace?.[peer]
	const file = path.posix.join(directory, `package.json`)
	const worktree = await createPeerWorktree(root, commit)
	const temporary = worktree.directory
	try {
		if (configured?.setupCommand)
			await runFile(`sh`, [`-c`, configured.setupCommand], temporary)
		const historical = await packages(temporary)
		const packed = new Map<string, string>()
		const overrides: Record<string, string> = {}
		const pack = async (manifestFile: string): Promise<string> => {
			const already = packed.get(manifestFile)
			if (already) return already
			const manifest: unknown = JSON.parse(
				await readFile(path.join(temporary, manifestFile), `utf8`),
			)
			if (
				!object(manifest) ||
				typeof manifest.name !== `string` ||
				typeof manifest.version !== `string`
			)
				throw new Error(`Invalid workspace package at ${manifestFile}.`)
			const filename = `workspace-${createHash(`sha256`).update(`${commit}:${manifestFile}`).digest(`hex`).slice(0, 24)}.tgz`
			packed.set(manifestFile, filename)
			for (const dependencies of [
				manifest.dependencies,
				manifest.optionalDependencies,
			]) {
				if (!object(dependencies)) continue
				for (const [name, range] of Object.entries(dependencies)) {
					if (typeof range !== `string` || !range.startsWith(`workspace:`))
						continue
					const matches = historical.filter((entry) => entry.name === name)
					const dependency = matches[0]
					const requested = range.slice(`workspace:`.length)
					if (
						matches.length !== 1 ||
						!dependency ||
						(![`*`, `^`, `~`].includes(requested) &&
							!satisfies(dependency.version, requested))
					)
						throw new Error(
							`Workspace dependency ${name}@${range} of ${manifest.name} cannot be materialized at ${commit}.`,
						)
					const archive = await pack(dependency.file)
					overrides[`${manifest.name}@${manifest.version}>${name}`] =
						`file:./.breakage-artifacts/${archive}`
				}
			}
			await runFile(
				`pnpm`,
				[
					`--config.ignore-scripts=true`,
					`pack`,
					`--out`,
					path.join(artifacts, filename),
				],
				path.dirname(path.join(temporary, manifestFile)),
			)
			return filename
		}
		return { filename: await pack(file), overrides }
	} finally {
		await worktree.cleanup()
	}
}
