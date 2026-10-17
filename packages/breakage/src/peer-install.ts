import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { createRequire } from "node:module"
import {
	copyFile,
	mkdir,
	readFile,
	realpath,
	rm,
	writeFile,
} from "node:fs/promises"
import path from "node:path"
import { simpleGit } from "simple-git"

import { object } from "./peer-config.ts"
import { packWorkspacePeer } from "./peer-workspace.ts"
import type { PeerEnvironment, PeerConfig } from "./peer-config.ts"

export async function runFile(
	file: string,
	args: string[],
	cwd: string,
): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile(
			file,
			args,
			{
				cwd,
				env: { ...process.env, npm_config_ignore_scripts: `true` },
				maxBuffer: 16 * 1024 * 1024,
			},
			(error, stdout, stderr) => {
				if (error)
					reject(
						new Error(
							`${file} ${args[0]} failed: ${stderr || stdout || error.message}`,
						),
					)
				else resolve(stdout.trim())
			},
		)
	})
}

export async function copyRegistryConfig(
	source: string,
	target: string,
): Promise<void> {
	const root = await simpleGit(source).revparse([`--show-toplevel`])
	const files = [
		...new Set([path.join(root, `.npmrc`), path.join(source, `.npmrc`)]),
	]
	const contents: string[] = []
	for (const file of files)
		if (existsSync(file)) contents.push(await readFile(file, `utf8`))
	if (contents.length)
		await writeFile(path.join(target, `.npmrc`), contents.join(`\n`))
}

export async function preparePeerInstall(
	config: PeerConfig,
	entry: PeerEnvironment,
	source: string,
	target: string,
): Promise<string> {
	await copyRegistryConfig(source, target)
	const manifestPath = path.resolve(source, config.manifest ?? `package.json`)
	const candidate: unknown = JSON.parse(await readFile(manifestPath, `utf8`))
	if (!object(candidate) || typeof candidate.name !== `string`)
		throw new Error(`The candidate manifest needs a package name.`)
	if (entry.peers[candidate.name] !== undefined)
		throw new Error(`The candidate cannot also be its own peer.`)
	const artifacts = path.join(target, `.breakage-artifacts`)
	await mkdir(artifacts, { recursive: true })
	await runFile(
		`pnpm`,
		[
			`--config.ignore-scripts=true`,
			`pack`,
			`--out`,
			path.join(artifacts, `candidate.tgz`),
		],
		path.dirname(manifestPath),
	)
	const dependencies: Record<string, string> = {
		...config.testDependencies,
		[candidate.name]: `file:./.breakage-artifacts/candidate.tgz`,
	}
	const overrides: Record<string, string> = {}
	let index = 0
	for (const [name, version] of Object.entries(entry.peers)) {
		if (version === null) {
			delete dependencies[name]
			continue
		}
		const sourceFile = config.sources?.[`${name}@${version}`]
		if (sourceFile) {
			const filename = `peer-${index++}.tgz`
			await copyFile(
				path.resolve(source, sourceFile),
				path.join(artifacts, filename),
			)
			dependencies[name] = `file:./.breakage-artifacts/${filename}`
		} else {
			const workspace = await packWorkspacePeer(
				config,
				source,
				name,
				version,
				artifacts,
			)
			if (workspace) {
				dependencies[name] = `file:./.breakage-artifacts/${workspace.filename}`
				for (const [selector, replacement] of Object.entries(
					workspace.overrides,
				)) {
					if (overrides[selector] && overrides[selector] !== replacement)
						throw new Error(
							`Workspace peers require conflicting historical artifacts for ${selector}.`,
						)
					overrides[selector] = replacement
				}
			} else dependencies[name] = version
		}
	}
	await writeFile(
		path.join(target, `package.json`),
		`${JSON.stringify({ name: `breakage-peer-environment`, private: true, type: candidate.type ?? `module`, scripts: candidate.scripts ?? {}, dependencies }, null, 2)}\n`,
	)
	await writeFile(
		path.join(target, `pnpm-workspace.yaml`),
		`${JSON.stringify({ packages: [], overrides }, null, 2)}\n`,
	)
	// The original workspace's lockfile describes a different dependency graph.
	await rm(path.join(target, `pnpm-lock.yaml`), { force: true })
	return candidate.name
}

export async function installPeerEnvironment(
	directory: string,
	frozen = false,
	lockOnly = false,
): Promise<void> {
	await runFile(
		`pnpm`,
		[
			`install`,
			`--ignore-scripts`,
			`--strict-peer-dependencies`,
			`--config.auto-install-peers=false`,
			`--config.link-workspace-packages=false`,
			`--config.resolve-peers-from-workspace-root=false`,
			frozen ? `--frozen-lockfile` : `--no-frozen-lockfile`,
			...(lockOnly ? [`--lockfile-only`] : []),
		],
		directory,
	)
}

export async function verifyPeerEnvironment(
	directory: string,
	candidate: string,
	entry: PeerEnvironment,
): Promise<void> {
	const installedCandidate = await realpath(
		path.join(directory, `node_modules`, candidate),
	)
	let candidateModules = path.dirname(installedCandidate)
	while (path.basename(candidateModules) !== `node_modules`) {
		const parent = path.dirname(candidateModules)
		if (parent === candidateModules)
			throw new Error(`Could not locate candidate dependency graph.`)
		candidateModules = parent
	}
	for (const [name, version] of Object.entries(entry.peers)) {
		if (version === null) {
			const locations =
				createRequire(
					path.join(installedCandidate, `package.json`),
				).resolve.paths(name) ?? []
			if (
				[path.join(directory, `node_modules`), ...locations].some((location) =>
					existsSync(path.join(location, name, `package.json`)),
				)
			)
				throw new Error(
					`Optional peer ${name} must be absent in environment ${entry.name}.`,
				)
			continue
		}
		if (
			(await realpath(path.join(directory, `node_modules`, name))) !==
			(await realpath(path.join(candidateModules, name)))
		)
			throw new Error(
				`Peer ${name} resolves to different package instances in the tests and candidate for environment ${entry.name}.`,
			)
		for (const modules of [
			path.join(directory, `node_modules`),
			candidateModules,
		]) {
			const actual: unknown = JSON.parse(
				await readFile(path.join(modules, name, `package.json`), `utf8`),
			)
			if (!object(actual) || actual.name !== name || actual.version !== version)
				throw new Error(
					`Peer ${name} did not resolve to the selected version ${version}.`,
				)
		}
	}
}
