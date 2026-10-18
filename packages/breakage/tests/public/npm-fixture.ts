import { execFileSync } from "node:child_process"
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import type { NpmConfig, NpmReport } from "breakage"

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
	pack: (source: string) => string
	representative: (label: string, version: string, candidate?: boolean) => void
	baseline: (peers: Record<string, string>) => void
	clean: () => void
}

export function npmFixture(): NpmFixture {
	const directory = mkdtempSync(path.join(tmpdir(), `breakage-npm-`))
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
	git(directory, `init`, `--initial-branch=main`)
	git(directory, `config`, `user.name`, `Npm Tests`)
	git(directory, `config`, `user.email`, `tests@example.invalid`)
	write(
		`.gitignore`,
		`node_modules/\nartifacts/\n.cache/\n.breakage/\npeer-environments/*/test/\n`,
	)
	write(`package.json`, {
		name: `integration`,
		version: `1.1.0`,
		type: `module`,
		main: `index.js`,
		peerDependencies: { host: `^1 || ^2` },
		files: [`index.js`],
	})
	write(
		`index.js`,
		`import host from 'host'; export { host }; export const value = host.value;`,
	)
	write(
		`contracts/check.ts`,
		`import { strict as assert } from 'node:assert'; import host from 'host'; import { host as used } from 'integration'; assert.equal(host, used); assert.equal(host.value, 'works');`,
	)
	write(`local-host/package.json`, {
		name: `host`,
		version: `2.0.0`,
		type: `module`,
		main: `index.js`,
		files: [`index.js`],
	})
	write(`local-host/index.js`, `export default { value: 'works' };`)
	const hostArchive = pack(`local-host`)
	const artifact = pack(`.`)
	const config: NpmConfig = {
		artifact,
		representatives: `peer-environments/*`,
		lockfile: `package-lock.json`,
		prepareCommand: `npm ci --ignore-scripts --offline --cache ../../.cache --no-audit --no-fund`,
		installCommand: `npm install --ignore-scripts --legacy-peer-deps --package-lock=false --offline --cache ../../../.cache --no-audit --no-fund`,
		suites: {
			host: { files: [`contracts/*.ts`], command: `node contracts/check.ts` },
		},
		localPeers: { host: { directory: `local-host`, artifact: hostArchive } },
		baseline: { firstRelease: true },
	}
	const representative = (
		label: string,
		version: string,
		candidate = false,
	): void => {
		write(`peer-source-${label}/package.json`, {
			name: `host`,
			version,
			type: `module`,
			main: `index.js`,
			files: [`index.js`],
		})
		write(`peer-source-${label}/index.js`, `export default { value: 'works' };`)
		const archive = pack(`peer-source-${label}`)
		const location = `peer-environments/${label}`
		const manifest = {
			name: `environment-${label}`,
			version: `1.0.0`,
			private: true,
			type: `module`,
			dependencies: candidate ? {} : { host: version },
			...(candidate ? { breakage: { candidates: [`host`] } } : {}),
		}
		write(`${location}/package.json`, manifest)
		// A genuine npm frozen installation, backed entirely by local packed releases.
		write(`${location}/package-lock.json`, {
			name: manifest.name,
			version: manifest.version,
			lockfileVersion: 3,
			requires: true,
			packages: {
				"": {
					name: manifest.name,
					version: manifest.version,
					dependencies: manifest.dependencies,
				},
				...(candidate
					? {}
					: {
							"node_modules/host": {
								version,
								resolved: `file:../../${archive}`,
							},
						}),
			},
		})
	}
	const baseline = (peers: Record<string, string>): void => {
		const current = read(`package.json`)
		write(`package.json`, {
			...JSON.parse(current),
			version: `1.0.0`,
			peerDependencies: peers,
		})
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
	return {
		directory,
		config,
		write,
		read,
		pack,
		representative,
		baseline,
		clean: () => rmSync(directory, { recursive: true, force: true }),
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
