import { cpSync, existsSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"

import { afterEach, describe, expect, it } from "bun:test"

import { npmCheck, npmTest } from "../src/npm/check.ts"
import type { NpmFixture } from "../tests/public/npm-fixture.ts"
import { assertStagesRemoved, npmFixture } from "../tests/public/npm-fixture.ts"

let fixture: NpmFixture | undefined
afterEach(() => {
	fixture?.clean()
	fixture = undefined
})

// Real published packages, pinned through development aliases and the lockfile.
// Minimatch 9 removed the default export used by the coordinated host below:
// https://github.com/isaacs/minimatch/blob/v9.0.5/changelog.md#90
async function setup(major: 8 | 9): Promise<NpmFixture> {
	const f = (fixture = npmFixture())
	const minimatchManifest = createRequire(import.meta.url).resolve(
		`minimatch-v${major}/package.json`,
	)
	const braceManifest = createRequire(minimatchManifest).resolve(
		`brace-expansion/package.json`,
	)
	const balancedManifest = createRequire(braceManifest).resolve(
		`balanced-match/package.json`,
	)
	const locked: Record<string, object> = {}
	// Repack the installed releases without changing their metadata or code.
	// Include both transitive dependencies so npm ci needs no registry access.
	for (const filename of [minimatchManifest, braceManifest, balancedManifest]) {
		const manifest = JSON.parse(readFileSync(filename, `utf8`)) as {
			name: string
			version: string
			dependencies?: Record<string, string>
		}
		const directory = path.dirname(filename)
		const copy = `published/${manifest.name}`
		cpSync(directory, path.join(f.directory, copy), {
			recursive: true,
			filter: (source) =>
				!path
					.relative(directory, source)
					.split(path.sep)
					.includes(`node_modules`),
		})
		const artifact = f.pack(copy)
		locked[`node_modules/${manifest.name}`] = {
			version: manifest.version,
			resolved: `file:../../${artifact}`,
			...(manifest.dependencies ? { dependencies: manifest.dependencies } : {}),
		}
	}
	const integrationPeers = { host: `^2`, minimatch: `^${major}` }
	for (const pkg of [
		{
			directory: `local-host`,
			name: `host`,
			version: `2.0.0`,
			peerDependencies: { minimatch: `^8` },
			source: `import minimatch from 'minimatch';
export { minimatch as matcher };
export const matches = (filename: string): boolean => minimatch(filename, '**/*.ts');`,
		},
		{
			directory: `.`,
			name: `integration`,
			version: `1.1.0`,
			peerDependencies: integrationPeers,
			source: `export { matches } from 'host';
export { minimatch as matcher } from 'minimatch';`,
		},
	]) {
		f.write(`${pkg.directory}/package.json`, {
			name: pkg.name,
			version: pkg.version,
			type: `module`,
			main: `dist/index.js`,
			files: [`dist`],
			peerDependencies: pkg.peerDependencies,
		})
		f.write(`${pkg.directory}/index.ts`, pkg.source)
		const build = await Bun.build({
			entrypoints: [path.join(f.directory, pkg.directory, `index.ts`)],
			outdir: path.join(f.directory, pkg.directory, `dist`),
			target: `node`,
			format: `esm`,
			external: [`host`, `minimatch`],
		})
		if (!build.success)
			throw new Error(`Fixture build failed: ${JSON.stringify(build.logs)}`)
		const archive = f.pack(pkg.directory)
		if (pkg.name === `host`) f.config.localPeers!.host!.artifact = archive
		else f.config.artifact = archive
	}
	f.config.releaseIntent = ({ packageName }) =>
		packageName === `host`
			? { status: `release`, version: `2.0.0` }
			: { status: `none` }
	f.write(
		`contracts/check.ts`,
		`import { strict as assert } from 'node:assert';
import { minimatch } from 'minimatch';
import { matcher as hostMatcher } from 'host';
import { matcher, matches } from 'integration';
assert.equal(hostMatcher, minimatch);
assert.equal(matcher, minimatch);
assert.equal(matches('src/file.ts'), true);
assert.equal(matches('src/file.md'), false);
console.log('Shared minimatch identity and file matching assertions passed.');`,
	)
	f.config.suites.minimatch = f.config.suites.host!
	const representative = {
		name: `environment-coordinated`,
		version: `1.0.0`,
		private: true,
		type: `module`,
		dependencies: { minimatch: major === 8 ? `8.0.7` : `9.0.9` },
		breakage: { candidates: [`host`] },
	}
	f.write(`peer-environments/coordinated/package.json`, representative)
	f.write(`peer-environments/coordinated/package-lock.json`, {
		name: representative.name,
		version: representative.version,
		lockfileVersion: 3,
		requires: true,
		packages: {
			"": {
				name: representative.name,
				version: representative.version,
				dependencies: representative.dependencies,
			},
			...locked,
		},
	})
	f.baseline(integrationPeers)
	return f
}

describe(`real minimatch major-version incompatibility`, () => {
	it(`passes with minimatch 8, whose default export the host requires`, async () => {
		const f = await setup(8)
		const result = await npmCheck(f.config, { baseDirectory: f.directory })
		assertStagesRemoved(f, result)
		expect(result.exitCode, JSON.stringify(result, null, 2)).toBe(0)
		expect(result.representatives[0]!.status).toBe(`passed`)
		for (const suite of result.representatives[0]!.suites) {
			expect(suite.status).toBe(`passed`)
			expect(suite.output).toContain(`file matching assertions passed`)
		}
	}, 30_000)

	it(`exposes the real import crash during focused exploration with minimatch 9`, async () => {
		const f = await setup(9)
		const result = await npmTest(
			f.config,
			{ representative: `peer-environments/coordinated` },
			{ baseDirectory: f.directory },
		)
		assertStagesRemoved(f, result)
		expect(result.exitCode, JSON.stringify(result, null, 2)).toBe(1)
		expect(result.representatives[0]!.status).toBe(`compatibility-failure`)
		expect(result.representatives[0]!.warnings).toEqual([
			`Coordinated candidate host@2.0.0 requires minimatch: ^8, but the representative provides minimatch@9.0.9. Running focused exploration outside declared support.`,
		])
		for (const suite of result.representatives[0]!.suites) {
			expect(suite.status).toBe(`compatibility-failure`)
			expect(suite.output).toContain(
				`does not provide an export named 'default'`,
			)
			expect(suite.output).toContain(`import minimatch from "minimatch"`)
		}
	}, 30_000)

	it.each([false, true])(
		`rejects the host's incompatible declaration before execution (coverage only: %s)`,
		async (coverageOnly) => {
			const f = await setup(9)
			f.config.installCommand = `touch ../../../candidate-installed && ${f.config.installCommand}`
			if (coverageOnly) {
				f.config.artifact = `not-built.tgz`
				f.config.localPeers!.host!.artifact = `not-built-host.tgz`
			}
			const result = await npmCheck(f.config, {
				baseDirectory: f.directory,
				coverageOnly,
			})
			assertStagesRemoved(f, result)
			const representative = result.representatives[0]!
			expect(result.support.status).toBe(`unchanged`)
			expect(representative.peers.host).toMatchObject({
				version: `2.0.0`,
				source: `candidate`,
			})
			expect(representative.peers.minimatch).toMatchObject({
				version: `9.0.9`,
				source: `installed`,
			})
			// Reject the known declaration conflict before the host's import can crash,
			// including in an audit that never installs or executes the candidate.
			expect(result.exitCode, JSON.stringify(result, null, 2)).toBe(2)
			expect(existsSync(path.join(f.directory, `candidate-installed`))).toBe(
				false,
			)
			expect(representative.status).toBe(`setup-error`)
			for (const detail of [`host`, `minimatch`, `^8`, `9.0.9`]) {
				expect(representative.error).toContain(detail)
			}
			for (const suite of representative.suites) {
				expect(suite.status).toBe(`not-run`)
			}
		},
		30_000,
	)
})
