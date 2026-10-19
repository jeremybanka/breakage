import { execFileSync } from "node:child_process"
import {
	cpSync,
	existsSync,
	globSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import path from "node:path"

import type { NpmConfig, NpmReport } from "breakage"

const transpiler = new Bun.Transpiler({ loader: `ts`, target: `node` })
const sharedProject = new URL(`./fixtures/npm/`, import.meta.url)

export function git(directory: string, ...args: string[]): string {
	return execFileSync(`git`, [`-C`, directory, ...args], {
		encoding: `utf8`,
		stdio: [`ignore`, `pipe`, `pipe`],
	})
}

export type NpmFixture = {
	directory: string
	config: NpmConfig
	write: (filename: string, value: string | object) => void
	read: (filename: string) => string
	update: (filename: string, changes: object) => void
	copy: (source: string | URL, destination: string) => void
	build: (source: string) => string
	pack: (source: string) => string
	representative: (label: string, version: string, candidate?: boolean) => void
	baseline: (peers: Record<string, string>) => void
	clean: () => void
}

export function npmFixture(
	project: URL = sharedProject,
	customize?: (fixture: NpmFixture) => void,
): NpmFixture {
	const directory = mkdtempSync(path.join(tmpdir(), `breakage-npm-`))
	const clean = (): void => rmSync(directory, { recursive: true, force: true })
	try {
		// Copy authored inputs and the prepared cache, then install afresh in each test.
		cpSync(project, directory, {
			recursive: true,
			filter: (entry) => path.basename(entry) !== `node_modules`,
		})
		const write = (filename: string, value: string | object): void => {
			const destination = path.join(directory, filename)
			mkdirSync(path.dirname(destination), { recursive: true })
			writeFileSync(
				destination,
				typeof value === `string` ? value : JSON.stringify(value),
			)
		}
		const read = (filename: string): string =>
			readFileSync(path.join(directory, filename), `utf8`)
		const update = (filename: string, changes: object): void => {
			write(filename, { ...JSON.parse(read(filename)), ...changes })
		}
		const copy = (source: string | URL, filename: string): void => {
			const destination = path.join(directory, filename)
			mkdirSync(path.dirname(destination), { recursive: true })
			cpSync(
				typeof source === `string` ? path.join(directory, source) : source,
				destination,
				{ recursive: true },
			)
		}
		const pack = (source: string): string => {
			mkdirSync(path.join(directory, `artifacts`), { recursive: true })
			const output = execFileSync(
				`npm`,
				[
					`pack`,
					`--json`,
					`--ignore-scripts`,
					`--offline`,
					`--cache`,
					path.join(directory, `.cache`),
					`--pack-destination`,
					path.join(directory, `artifacts`),
				],
				{
					cwd: path.join(directory, source),
					encoding: `utf8`,
					stdio: [`ignore`, `pipe`, `pipe`],
				},
			)
			return `artifacts/${(JSON.parse(output) as { filename: string }[])[0]!.filename}`
		}
		const build = (source: string): string => {
			const manifest = JSON.parse(read(`${source}/package.json`)) as {
				main: string
			}
			// Preserve peer imports so Node resolves the consumer's installed packages.
			write(
				`${source}/${manifest.main}`,
				transpiler.transformSync(read(`${source}/src/index.ts`)),
			)
			return pack(source)
		}
		git(directory, `init`, `--initial-branch=main`)
		git(directory, `config`, `user.name`, `Npm Tests`)
		git(directory, `config`, `user.email`, `tests@example.invalid`)
		const config: NpmConfig = existsSync(
			path.join(directory, `breakage.config.ts`),
		)
			? (
					createRequire(import.meta.url)(
						path.join(directory, `breakage.config.ts`),
					) as { default: { npm: NpmConfig } }
				).default.npm
			: JSON.parse(read(`breakage.config.json`)).npm
		const representative = (
			label: string,
			version: string,
			candidate = false,
		): void => {
			// Explicitly selected case environments replace the project's default selection.
			config.representatives = `peer-environments/*`
			const location = `peer-environments/${label}`
			copy(
				new URL(
					`environments/${candidate ? `candidate` : `released-1`}/`,
					sharedProject,
				),
				location,
			)
			const name = `environment-${label}`
			const manifest = JSON.parse(read(`${location}/package.json`))
			const lock = JSON.parse(read(`${location}/package-lock.json`))
			manifest.name = name
			lock.name = name
			lock.packages[``].name = name
			if (!candidate) {
				const source = `peer-source-${label}`
				copy(new URL(`local-host/`, sharedProject), source)
				update(`${source}/package.json`, { version })
				const archive = build(source)
				manifest.dependencies.host = version
				lock.packages[``].dependencies.host = version
				Object.assign(lock.packages[`node_modules/host`], {
					version,
					resolved: `file:../../${archive}`,
				})
			}
			write(`${location}/package.json`, manifest)
			write(`${location}/package-lock.json`, lock)
		}
		const baseline = (peers: Record<string, string>): void => {
			const current = read(`package.json`)
			update(`package.json`, { version: `1.0.0`, peerDependencies: peers })
			git(directory, `add`, `.`)
			git(directory, `commit`, `-m`, `Released baseline`)
			const commit = git(directory, `rev-parse`, `HEAD`).trim()
			git(directory, `tag`, `integration@1.0.0`)
			write(`.breakage/baseline.json`, {
				version: 1,
				tagPattern: null,
				packageDirectory: ``,
				ref: `refs/tags/integration@1.0.0`,
				commit,
			})
			write(`package.json`, current)
			config.baseline = { baselineFile: `.breakage/baseline.json` }
		}
		const fixture: NpmFixture = {
			directory,
			config,
			write,
			read,
			update,
			copy,
			build,
			pack,
			representative,
			baseline,
			clean,
		}
		customize?.(fixture)
		for (const entrypoint of globSync(`**/src/index.ts`, { cwd: directory })) {
			const source = path.dirname(path.dirname(entrypoint))
			const filename = `${source}/package.json`
			const manifest = JSON.parse(read(filename))
			// npm must find fixture tarballs from inside an installed candidate. Only
			// the disposable manifest gets absolute paths into this test's artifacts.
			for (const section of [`dependencies`, `optionalDependencies`]) {
				for (const [name, specifier] of Object.entries(
					manifest[section] ?? {},
				)) {
					if (
						typeof specifier === `string` &&
						specifier.startsWith(`file:./artifacts/`)
					) {
						manifest[section][name] =
							`file:${path.join(directory, specifier.slice(7))}`
					}
				}
			}
			write(filename, manifest)
			const artifact = build(source)
			if (source === `.`) config.artifact = artifact
			for (const peer of Object.values(config.localPeers ?? {})) {
				if (peer.directory === source) peer.artifact = artifact
			}
		}
		return fixture
	} catch (error) {
		clean()
		throw error
	}
}

export function assertStagesRemoved(
	fixture: NpmFixture,
	report: NpmReport,
): void {
	for (const representative of report.representatives) {
		if (existsSync(path.join(fixture.directory, representative.path, `test`)))
			throw new Error(`Stage leaked for ${representative.path}.`)
	}
}
