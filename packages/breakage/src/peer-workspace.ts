import { createHash } from "node:crypto"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { satisfies } from "semver"
import { simpleGit } from "simple-git"
import type { SimpleGit } from "simple-git"

import { object } from "./peer-config.ts"
import type { PeerConfig } from "./peer-config.ts"
import { runFile } from "./peer-install.ts"
import { withDirectoryLock } from "./directory-lock.ts"

type WorkspacePackage = { file: string; name: string; version: string }

async function packages(
	git: SimpleGit,
	commit: string,
): Promise<WorkspacePackage[]> {
	const files = (await git.raw([`ls-tree`, `-r`, `--name-only`, `-z`, commit]))
		.split(`\0`)
		.filter((file) => file === `package.json` || file.endsWith(`/package.json`))
	const result: WorkspacePackage[] = []
	for (const file of files) {
		const manifest: unknown = JSON.parse(await git.show([`${commit}:${file}`]))
		if (
			object(manifest) &&
			typeof manifest.name === `string` &&
			typeof manifest.version === `string`
		)
			result.push({ file, name: manifest.name, version: manifest.version })
	}
	return result
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
	const sourceGit = simpleGit(source)
	const root = await sourceGit.revparse([`--show-toplevel`])
	const git = simpleGit(root)
	const configured = config.workspace?.[peer]
	const current = (await packages(git, `HEAD`)).filter(
		(entry) => entry.name === peer,
	)
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
	let tags = (await git.tags()).all.filter(matches)
	if (
		!tags.length &&
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
		const common = await git.revparse([
			`--path-format=absolute`,
			`--git-common-dir`,
		])
		for (const ref of remote)
			await withDirectoryLock(path.join(common, `breakage-fetch.lock`), () =>
				git.fetch([
					`origin`,
					`${ref}:${ref}`,
					`--no-tags`,
					`--no-write-fetch-head`,
				]),
			)
		tags = (await git.tags()).all.filter(matches)
	}
	const releases: { tag: string; commit: string }[] = []
	for (const tag of tags) {
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
	if (releases.length !== 1)
		throw new Error(
			`Workspace peer ${peer}@${version} needs exactly one matching release tag with that package version at ${file}; found ${releases.length}. Fetch its release tag or configure workspace[${JSON.stringify(peer)}].tagPattern.`,
		)
	const { commit } = releases[0]!
	const temporary = await mkdtemp(
		path.join(tmpdir(), `breakage-workspace-peer-`),
	)
	try {
		await simpleGit().clone(root, temporary, [`--no-local`, `--quiet`])
		await simpleGit(temporary).checkout(commit)
		if (configured?.setupCommand)
			await runFile(`sh`, [`-c`, configured.setupCommand], temporary)
		const historical = await packages(git, commit)
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
		await rm(temporary, { recursive: true, force: true })
	}
}
