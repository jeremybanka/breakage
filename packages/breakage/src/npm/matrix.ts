import { randomUUID } from "node:crypto"
import {
	copyFile,
	glob,
	lstat,
	mkdir,
	readFile,
	realpath,
	rename,
	rm,
	writeFile,
} from "node:fs/promises"
import path from "node:path"
import { simpleGit } from "simple-git"
import { loadConfig } from "../config.ts"
import { withDirectoryLock } from "../directory-lock.ts"
import {
	resolveReleaseDelta,
	versionDelta,
	type ReleaseDeltaContext,
} from "../release.ts"
import { prepare, errorMessage } from "../task.ts"
import { npmCheck, npmTestPlanned, formatNpmReport } from "./check.ts"
import { validateConfig } from "./config.ts"
import { discover, within } from "./environment.ts"
import { readManifest } from "./manifest.ts"
import type { NpmConfig } from "./types.ts"
import {
	canonical,
	digest,
	npmMatrixConfigSchema,
	peerIdentities,
	planDigest,
	requireMatrix,
	validateNpmPlan,
	verifyNpmReceipts,
	type NpmArchiveRequest,
	type NpmMatrixConfig,
	type NpmPlan,
	type NpmReceipt,
	type NpmVerification,
} from "./matrix-model.ts"

export { verifyNpmReceipts } from "./matrix-model.ts"
export type {
	NpmMatrixConfig,
	NpmMatrixLabelContext,
	NpmPrepareContext,
	NpmArchiveRequest,
	NpmPlan,
	NpmReceipt,
	NpmVerification,
} from "./matrix-model.ts"
export type NpmMatrixLocation = {
	rootDirectory?: string
	bundleDirectory?: string
}

function relative(root: string, filename: string): string {
	const result =
		path.relative(root, path.resolve(filename)).split(path.sep).join(`/`) || `.`
	requireMatrix(
		!result.startsWith(`../`) && result !== `..` && !path.isAbsolute(result),
		`Matrix input escapes the source checkout: ${filename}.`,
	)
	return result
}
function portablePath(value: string): void {
	requireMatrix(
		value.length &&
			!value.includes(`\\`) &&
			!path.posix.isAbsolute(value) &&
			!/^[A-Za-z]:/.test(value) &&
			!value.split(`/`).includes(`..`),
		`Invalid portable path: ${value}.`,
	)
}
async function contained(root: string, filename: string): Promise<string> {
	portablePath(filename)
	const absolute = path.resolve(root, filename)
	// Check the nearest existing ancestor as well as the final path.
	let ancestor = absolute
	for (;;) {
		try {
			await lstat(ancestor)
			break
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== `ENOENT`) throw error
			ancestor = path.dirname(ancestor)
		}
	}
	requireMatrix(
		within(await realpath(root), await realpath(ancestor)),
		`Path escapes its root through a symlink: ${filename}.`,
	)
	return absolute
}
async function fileDigest(filename: string): Promise<string> {
	requireMatrix(
		(await lstat(filename)).isFile(),
		`Expected a regular file: ${filename}.`,
	)
	return digest(await readFile(filename))
}
async function sourceIdentity(root: string): Promise<string> {
	const git = simpleGit(root)
	requireMatrix(
		(await realpath(await git.revparse([`--show-toplevel`]))) ===
			(await realpath(root)),
		`Matrix rootDirectory must be the Git checkout root.`,
	)
	requireMatrix(
		!(await git.status()).files.length,
		`Matrix planning and execution require a clean checkout, including untracked files. Ignore generated archives, bundles, and receipts.`,
	)
	return await git.revparse([`HEAD`])
}
async function ignoredOutput(root: string, filename: string): Promise<void> {
	const git = simpleGit(root)
	requireMatrix(
		!(await git.raw([`ls-files`, `--`, filename])).trim() &&
			(await git.raw([`check-ignore`, `--`, filename])).trim(),
		`Matrix output must be gitignored and untracked: ${filename}.`,
	)
}

async function discoverConfigs(
	root: string,
	patterns: string[],
): Promise<string[]> {
	const files = new Set<string>()
	for (const pattern of patterns) portablePath(pattern)
	for await (const filename of glob(patterns, {
		cwd: root,
		exclude: [`**/node_modules/**`, `**/.git/**`, `**/test/**`],
	})) {
		const name = relative(root, path.resolve(root, filename))
		const config = await loadConfig(await contained(root, name))
		if (config.npm) files.add(name)
	}
	requireMatrix(files.size, `No npm configurations matched the matrix configs.`)
	return [...files].sort()
}
function configDigest(config: NpmConfig, root: string, base: string): string {
	return digest(
		canonical({
			...config,
			packageDirectory: relative(root, base),
			artifact: relative(root, path.resolve(base, config.artifact)),
			baseline:
				`baselineFile` in config.baseline && config.baseline.baselineFile
					? {
							...config.baseline,
							baselineFile: relative(
								root,
								path.resolve(base, config.baseline.baselineFile),
							),
						}
					: config.baseline,
			localPeers: Object.fromEntries(
				Object.entries(config.localPeers ?? {}).map(([name, peer]) => [
					name,
					{
						directory: relative(root, path.resolve(base, peer.directory)),
						artifact: relative(root, path.resolve(base, peer.artifact)),
					},
				]),
			),
			release: config.release
				? {
						resolveDelta: !!config.release.resolveDelta,
						policy: !!config.release.policy,
					}
				: undefined,
		}),
	)
}
async function packageConfig(root: string, filename: string) {
	const config = (await loadConfig(await contained(root, filename))).npm
	validateConfig(config)
	const baseDirectory = path.dirname(path.resolve(root, filename))
	const base = path.resolve(baseDirectory, config.packageDirectory ?? `.`)
	await contained(root, relative(root, base))
	return { config, base, baseDirectory }
}
function portableContext(
	root: string,
	context: ReleaseDeltaContext,
): ReleaseDeltaContext {
	return {
		...context,
		packageDirectory: relative(root, context.packageDirectory),
	}
}

async function archiveRequests(
	root: string,
	config: NpmConfig,
	base: string,
): Promise<NpmArchiveRequest[]> {
	const manifest = await readManifest(path.join(base, `package.json`))
	const requests: NpmArchiveRequest[] = [
		{
			packageName: manifest.name,
			directory: relative(root, base),
			artifact: relative(root, path.resolve(base, config.artifact)),
		},
	]
	for (const [packageName, peer] of Object.entries(config.localPeers ?? {})) {
		const directory = relative(root, path.resolve(base, peer.directory))
		try {
			await lstat(await contained(root, directory))
		} catch (error) {
			// Preserve registrations needed only to interpret a removed historical peer.
			if (
				(error as NodeJS.ErrnoException).code === `ENOENT` &&
				!manifest.peerDependencies?.[packageName]
			)
				continue
			throw error
		}
		requests.push({
			packageName,
			directory,
			artifact: relative(root, path.resolve(base, peer.artifact)),
		})
	}
	return requests
}

// Include ignored/generated contracts and frozen inputs: a clean Git tree alone
// cannot bind them to the coverage audit. File discovery is part of the digest.
async function inputDigest(
	root: string,
	filename: string,
	config: NpmConfig,
	base: string,
): Promise<string> {
	const files = new Set([
		filename,
		relative(root, path.join(base, `package.json`)),
	])
	const directories = await discover(config, base)
	for (const directory of directories)
		for (const name of [`package.json`, config.lockfile])
			files.add(relative(root, path.join(directory, name)))
	for (const request of await archiveRequests(root, config, base))
		files.add(
			relative(root, path.resolve(root, request.directory, `package.json`)),
		)
	if (`baselineFile` in config.baseline && config.baseline.baselineFile)
		files.add(relative(root, path.resolve(base, config.baseline.baselineFile)))
	const exclude = [
		`**/node_modules/**`,
		`**/.git/**`,
		...directories.flatMap((directory) => {
			const stage = relative(base, path.join(directory, `test`))
			return [stage, `${stage}/**`]
		}),
	]
	for (const suite of Object.values(config.suites)) {
		for (const pattern of suite.files) {
			portablePath(pattern)
			let count = 0
			for await (const file of glob(pattern, { cwd: base, exclude })) {
				const absolute = path.resolve(base, file)
				if ((await lstat(absolute)).isDirectory()) continue
				files.add(relative(root, absolute))
				count++
			}
			requireMatrix(count, `Suite pattern matched no files: ${pattern}.`)
		}
	}
	const inputs = await Promise.all(
		[...files]
			.sort()
			.map(async (file) => [
				file,
				await fileDigest(await contained(root, file)),
			]),
	)
	return digest(canonical(inputs))
}

/** Audit all configured packages and prepare one immutable, portable archive bundle. */
export async function npmPlan(
	config: NpmMatrixConfig,
	options: NpmMatrixLocation = {},
): Promise<NpmPlan> {
	npmMatrixConfigSchema.assert(config)
	const root = path.resolve(options.rootDirectory ?? process.cwd())
	const output = options.bundleDirectory ?? `.breakage/npm-plan`
	const bundle = await contained(
		root,
		relative(root, path.resolve(root, output)),
	)
	await ignoredOutput(root, path.join(bundle, `plan.json`))
	await mkdir(bundle, { recursive: true })
	return await withDirectoryLock(path.join(bundle, `.lock`), async () => {
		// A failed re-plan must not leave yesterday's successful plan available.
		await rm(path.join(bundle, `plan.json`), { force: true })
		const commit = await sourceIdentity(root)
		const patterns =
			typeof config.configs === `string` ? [config.configs] : config.configs
		const files = await discoverConfigs(root, patterns)
		const packages: NpmPlan[`packages`] = []
		const environments: NpmPlan[`environments`] = []
		const requests = new Map<string, NpmArchiveRequest>()
		for (const filename of files) {
			const {
				config: npm,
				base,
				baseDirectory,
			} = await packageConfig(root, filename)
			const manifest = await readManifest(path.join(base, `package.json`))
			for (const peer of Object.keys(manifest.peerDependencies ?? {}))
				requireMatrix(
					npm.suites[peer] || manifest.peerDependenciesMeta?.[peer]?.optional,
					`Missing relationship suite for ${manifest.name}: ${peer}.`,
				)
			const releases: NpmPlan[`packages`][number][`releases`] = []
			const effective: NpmConfig = {
				...npm,
				...(npm.release
					? {
							release: {
								...npm.release,
								resolveDelta: async (context) => {
									const transition = await resolveReleaseDelta(
										npm.release!,
										context,
									)
									releases.push({
										context: portableContext(root, context),
										...(transition ? { transition } : {}),
									})
									return transition
								},
							},
						}
					: {}),
			}
			const audit = await npmCheck(effective, {
				baseDirectory,
				coverageOnly: true,
			})
			requireMatrix(
				audit.exitCode === 0,
				`Cannot plan ${manifest.name}:\n${formatNpmReport(audit)}`,
			)
			for (const result of audit.representatives) {
				requireMatrix(
					result.status === `audited` && result.suites.length,
					`Environment has no executable audited suites: ${manifest.name} / ${result.path}.`,
				)
				const environment = JSON.parse(
					await readFile(path.join(base, result.path, `package.json`), `utf8`),
				) as { description?: unknown }
				const label =
					config.label?.({
						packageName: manifest.name,
						representative: result.path,
						peers: result.peers,
						...(typeof environment.description === `string`
							? { description: environment.description }
							: {}),
					}) ?? `${manifest.name}: ${result.path}`
				requireMatrix(
					typeof label === `string` && label.trim(),
					`Invalid label for ${manifest.name} / ${result.path}.`,
				)
				environments.push({
					id: digest(`${filename}\0${result.path}`).slice(0, 24),
					label,
					packageName: manifest.name,
					representative: result.path,
					suites: result.suites.map((s) => s.peer).sort(),
					peers: peerIdentities(result.peers),
				})
				// Store portable identities; execution paths belong to each receipt's runner.
				for (const peer of Object.values(result.peers))
					peer.path = `(runner-local)`
			}
			packages.push({
				config: filename,
				directory: relative(root, base),
				name: manifest.name,
				configDigest: configDigest(npm, root, base),
				inputDigest: await inputDigest(root, filename, npm, base),
				audit,
				releases: releases.sort((a, b) =>
					canonical(a.context).localeCompare(canonical(b.context)),
				),
			})
			for (const request of await archiveRequests(root, npm, base)) {
				const previous = requests.get(request.artifact)
				requireMatrix(
					!previous || canonical(previous) === canonical(request),
					`Conflicting archive requests: ${request.artifact}.`,
				)
				requests.set(request.artifact, request)
			}
		}
		const archives = [...requests.values()].sort((a, b) =>
			a.artifact.localeCompare(b.artifact),
		)
		for (const request of archives) {
			await contained(root, request.directory)
			await contained(root, request.artifact)
			await ignoredOutput(root, path.resolve(root, request.artifact))
		}
		if (typeof config.prepare === `string`) await prepare(config.prepare, root)
		else await config.prepare({ rootDirectory: root, archives })
		const packed: NpmPlan[`archives`] = []
		for (const archive of archives) {
			const filename = await contained(root, archive.artifact)
			const sha256 = await fileDigest(filename)
			const file = `archives/${sha256}.tgz`
			await mkdir(path.join(bundle, `archives`), { recursive: true })
			await copyFile(filename, await contained(bundle, file))
			packed.push({ path: archive.artifact, file, sha256 })
		}
		requireMatrix(
			(await sourceIdentity(root)) === commit,
			`Source changed while preparing the matrix.`,
		)
		const payload = {
			formatVersion: 1 as const,
			runId: randomUUID(),
			commit,
			configs: patterns,
			packages,
			environments,
			archives: packed,
		}
		const plan = validateNpmPlan({ ...payload, id: planDigest(payload) })
		await validateWorkspace(plan, {
			rootDirectory: root,
			bundleDirectory: bundle,
		})
		await writeMatrixJson(path.join(bundle, `plan.json`), plan)
		return plan
	})
}

async function validateWorkspace(plan: NpmPlan, options: NpmMatrixLocation) {
	const root = path.resolve(options.rootDirectory ?? process.cwd())
	const bundle = path.resolve(
		root,
		options.bundleDirectory ?? `.breakage/npm-plan`,
	)
	requireMatrix(
		(await sourceIdentity(root)) === plan.commit,
		`Plan belongs to a different source commit.`,
	)
	requireMatrix(
		canonical(await discoverConfigs(root, plan.configs)) ===
			canonical(plan.packages.map((p) => p.config).sort()),
		`Plan no longer enumerates every configured npm package.`,
	)
	const configs = new Map<string, Awaited<ReturnType<typeof packageConfig>>>()
	const requiredArchives = new Set<string>()
	for (const pkg of plan.packages) {
		const loaded = await packageConfig(root, pkg.config)
		const { config, base } = loaded
		for (const request of await archiveRequests(root, config, base))
			requiredArchives.add(request.artifact)
		requireMatrix(
			relative(root, base) === pkg.directory &&
				configDigest(config, root, base) === pkg.configDigest,
			`Configuration changed for ${pkg.name}.`,
		)
		requireMatrix(
			(await inputDigest(root, pkg.config, config, base)) === pkg.inputDigest,
			`Contract, manifest, or lockfile inputs changed for ${pkg.name}.`,
		)
		const representatives = (await discover(config, base))
			.map((d) => relative(base, d))
			.sort()
		requireMatrix(
			canonical(representatives) ===
				canonical(pkg.audit.representatives.map((r) => r.path).sort()),
			`Representative discovery changed for ${pkg.name}.`,
		)
		for (const release of pkg.releases) {
			requireMatrix(
				config.release,
				`Release configuration disappeared for ${pkg.name}.`,
			)
			const actual = await resolveReleaseDelta(config.release, {
				...release.context,
				packageDirectory: await contained(
					root,
					release.context.packageDirectory,
				),
			})
			requireMatrix(
				canonical(actual) === canonical(release.transition),
				`Release evidence changed for ${pkg.name} / ${release.context.packageName}.`,
			)
		}
		if (pkg.audit.support.release) {
			const expected = pkg.audit.support.release
			requireMatrix(
				canonical(
					versionDelta(
						expected.previousVersion,
						expected.version,
						config.release?.policy,
					),
				) === canonical(expected),
				`Release policy changed for ${pkg.name}.`,
			)
		}
		configs.set(pkg.name, loaded)
	}
	requireMatrix(
		canonical([...requiredArchives].sort()) ===
			canonical(plan.archives.map((a) => a.path).sort()),
		`Planned archives do not match the configured packages and local peers.`,
	)
	for (const archive of plan.archives) {
		portablePath(archive.path)
		requireMatrix(
			archive.file === `archives/${archive.sha256}.tgz`,
			`Invalid bundled archive path: ${archive.file}.`,
		)
		requireMatrix(
			(await fileDigest(await contained(bundle, archive.file))) ===
				archive.sha256,
			`Candidate archive changed: ${archive.path}.`,
		)
	}
	return { root, bundle, configs }
}

/** Execute exactly one audited environment, producing failure evidence whenever the plan is valid. */
export async function npmExecute(
	value: unknown,
	id: string,
	options: NpmMatrixLocation = {},
): Promise<NpmReceipt> {
	const plan = validateNpmPlan(value)
	const receipt: NpmReceipt = {
		formatVersion: 1,
		planId: plan.id,
		id,
		exitCode: 2,
	}
	try {
		const env = plan.environments.find((e) => e.id === id)
		requireMatrix(env, `Unknown planned environment: ${id}.`)
		const { root, bundle, configs } = await validateWorkspace(plan, options)
		const { config, baseDirectory } = configs.get(env.packageName)!
		// Use the immutable bundle directly: no archive installation into the checkout.
		const byPath = new Map(
			plan.archives.map((a) => [a.path, path.join(bundle, a.file)]),
		)
		const base = path.resolve(baseDirectory, config.packageDirectory ?? `.`)
		const artifactFor = (filename: string): string => {
			const archive = byPath.get(relative(root, path.resolve(base, filename)))
			requireMatrix(archive, `Plan is missing archive: ${filename}.`)
			return archive
		}
		const effective: NpmConfig = {
			...config,
			artifact: artifactFor(config.artifact),
			localPeers: Object.fromEntries(
				Object.entries(config.localPeers ?? {}).map(([name, peer]) => [
					name,
					{
						...peer,
						artifact:
							byPath.get(relative(root, path.resolve(base, peer.artifact))) ??
							peer.artifact,
					},
				]),
			),
		}
		receipt.report = await npmTestPlanned(
			effective,
			{ representative: env.representative, suites: env.suites },
			{ baseDirectory },
		)
		receipt.exitCode = receipt.report.exitCode
		// Tests/preparation cannot rewrite inputs or bundled artifacts and still attest success.
		await validateWorkspace(plan, options)
		if (receipt.exitCode === 0) {
			const result = receipt.report.representatives.find(
				(r) => r.path === env.representative,
			)
			requireMatrix(
				result?.status === `passed` &&
					canonical(result.suites.map((s) => s.peer).sort()) ===
						canonical(env.suites) &&
					result.suites.every((s) => s.status === `passed`) &&
					canonical(peerIdentities(result.peers)) === canonical(env.peers),
				`Execution differs from the planned suites or peer identities: ${env.label}.`,
			)
		}
	} catch (error) {
		receipt.exitCode = 2
		receipt.error = errorMessage(error)
	}
	return receipt
}

/** Verify source/config/archive identities and then require all planned execution receipts. */
export async function npmVerify(
	value: unknown,
	receipts: readonly unknown[],
	options: NpmMatrixLocation = {},
): Promise<NpmVerification> {
	try {
		const plan = validateNpmPlan(value)
		await validateWorkspace(plan, options)
		return verifyNpmReceipts(plan, receipts)
	} catch (error) {
		return { exitCode: 2, errors: [errorMessage(error)], environments: 0 }
	}
}

export function npmMatrix(value: unknown): {
	include: {
		id: string
		label: string
		packageName: string
		representative: string
	}[]
} {
	return {
		include: validateNpmPlan(value).environments.map(
			({ id, label, packageName, representative }) => ({
				id,
				label,
				packageName,
				representative,
			}),
		),
	}
}

export async function writeMatrixJson(
	filename: string,
	value: unknown,
): Promise<void> {
	await mkdir(path.dirname(filename), { recursive: true })
	const temporary = `${filename}.${randomUUID()}.tmp`
	try {
		await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
			flag: `wx`,
		})
		await rename(temporary, filename)
	} finally {
		await rm(temporary, { force: true })
	}
}
