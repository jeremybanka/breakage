import { existsSync } from "node:fs"
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

// Real published packages, pinned and prepared by each peer environment.
// Minimatch 9 removed the default export used by the coordinated host below:
// https://github.com/isaacs/minimatch/blob/v9.0.5/changelog.md#90
function setup(major: 8 | 9): NpmFixture {
	const f = (fixture = npmFixture(
		new URL(`./fixtures/npm/candidate-minimatch/`, import.meta.url),
		(project) => {
			project.update(`package.json`, {
				peerDependencies: { "minimatch-host": `^2`, minimatch: `^${major}` },
			})
			project.config.representatives = `peer-environments/minimatch-${major}`
		},
	))
	f.baseline(JSON.parse(f.read(`package.json`)).peerDependencies)
	return f
}

describe(`real minimatch major-version incompatibility`, () => {
	it(`passes with minimatch 8, whose default export the host requires`, async () => {
		const f = setup(8)
		// The source fixture is prepared for type checking, but runtime evidence
		// must come from a fresh frozen installation in the disposable project.
		for (const directory of [
			`node_modules`,
			`peer-environments/minimatch-8/node_modules`,
			`peer-environments/minimatch-9/node_modules`,
		]) {
			expect(existsSync(path.join(f.directory, directory))).toBe(false)
		}
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
		const f = setup(9)
		const version = JSON.parse(
			f.read(`peer-environments/minimatch-9/package.json`),
		).dependencies.minimatch
		const result = await npmTest(
			f.config,
			{ representative: `peer-environments/minimatch-9` },
			{ baseDirectory: f.directory },
		)
		assertStagesRemoved(f, result)
		expect(result.exitCode, JSON.stringify(result, null, 2)).toBe(1)
		expect(result.representatives[0]!.status).toBe(`compatibility-failure`)
		expect(result.representatives[0]!.warnings).toEqual([
			`Coordinated candidate minimatch-host@2.0.0 requires minimatch: ^8, but the representative provides minimatch@${version}. Running focused exploration outside declared support.`,
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
			const f = setup(9)
			const version = JSON.parse(
				f.read(`peer-environments/minimatch-9/package.json`),
			).dependencies.minimatch
			f.config.installCommand = `touch ../../../candidate-installed && ${f.config.installCommand}`
			if (coverageOnly) {
				f.config.artifact = `not-built.tgz`
				f.config.localPeers![`minimatch-host`]!.artifact = `not-built-host.tgz`
			}
			const result = await npmCheck(f.config, {
				baseDirectory: f.directory,
				coverageOnly,
			})
			assertStagesRemoved(f, result)
			const representative = result.representatives[0]!
			expect(result.support.status).toBe(`unchanged`)
			expect(representative.peers[`minimatch-host`]).toMatchObject({
				version: `2.0.0`,
				source: `candidate`,
			})
			expect(representative.peers.minimatch).toMatchObject({
				version,
				source: `installed`,
			})
			// Reject the known declaration conflict before the host's import can crash,
			// including in an audit that never installs or executes the candidate.
			expect(result.exitCode, JSON.stringify(result, null, 2)).toBe(2)
			expect(existsSync(path.join(f.directory, `candidate-installed`))).toBe(
				false,
			)
			expect(representative.status).toBe(`setup-error`)
			for (const detail of [`minimatch-host`, `minimatch`, `^8`, version]) {
				expect(representative.error).toContain(detail)
			}
			for (const suite of representative.suites) {
				expect(suite.status).toBe(`not-run`)
			}
		},
		30_000,
	)
})
