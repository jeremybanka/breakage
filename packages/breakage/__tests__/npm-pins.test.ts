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

describe(`representative dependency pins`, () => {
	it.each([
		`^1`,
		`^1 || ^2`,
		`~1.0.0`,
		`1`,
		`1.0`,
		`1.x`,
		`*`,
		`>=1.0.0`,
		`1.0.0 - 2.0.0`,
		`1.0.0 || 2.0.0`,
		`=1.0.0`,
		`latest`,
		`workspace:1.0.0`,
		`file:../../artifacts/host-1.0.0.tgz`,
		`npm:host@1.0.0`,
		`https://example.invalid/host.tgz`,
		`v1.0.0`,
	])(
		`rejects dependency specifier %s before preparation`,
		async (specifier) => {
			const f = (fixture = npmFixture())
			const directory = `environments/released-1`
			f.config.representatives = directory
			f.config.prepareCommand = `touch prepared`
			f.update(`${directory}/package.json`, {
				dependencies: { host: specifier },
			})
			const result = await npmTest(
				f.config,
				{ representative: directory },
				{ baseDirectory: f.directory },
			)
			expect(result.exitCode).toBe(2)
			expect(result.representatives[0]!.error).toContain(
				`must pin dependencies.host to an exact version`,
			)
			expect(result.representatives[0]!.error).toContain(specifier)
			expect(existsSync(path.join(f.directory, directory, `prepared`))).toBe(
				false,
			)
			assertStagesRemoved(f, result)
		},
		30_000,
	)

	it.each([
		`dependencies`,
		`devDependencies`,
		`optionalDependencies`,
		`peerDependencies`,
	] as const)(
		`validates non-suite dependencies in %s during checks and audits`,
		async (field) => {
			const f = (fixture = npmFixture())
			const directory = `environments/released-1`
			f.config.representatives = directory
			f.config.prepareCommand = `touch prepared`
			f.update(`${directory}/package.json`, {
				[field]: {
					...(field === `dependencies` ? { host: `1.0.0` } : {}),
					runner: `^1`,
				},
			})
			for (const coverageOnly of [false, true]) {
				const result = await npmCheck(f.config, {
					baseDirectory: f.directory,
					coverageOnly,
				})
				expect(result.exitCode).toBe(2)
				expect(result.representatives[0]!.error).toContain(
					`must pin ${field}.runner to an exact version`,
				)
				expect(existsSync(path.join(f.directory, directory, `prepared`))).toBe(
					false,
				)
				assertStagesRemoved(f, result)
			}
		},
		30_000,
	)

	it.each([`1.0.0`, `2.1.4`, `3.0.0-beta.1`, `3.0.0+build.1`])(
		`executes an environment pinned to %s`,
		async (version) => {
			const f = (fixture = npmFixture())
			f.representative(`pinned`, version)
			const result = await npmTest(
				f.config,
				{ representative: `peer-environments/pinned` },
				{ baseDirectory: f.directory },
			)
			expect(result.exitCode, JSON.stringify(result)).toBe(0)
			expect(result.representatives[0]!.peers.host!.version).toBe(version)
			expect(result.representatives[0]!.suites[0]!.status).toBe(`passed`)
			assertStagesRemoved(f, result)
		},
		30_000,
	)

	it(`rejects an installed peer that differs from its exact pin`, async () => {
		const f = (fixture = npmFixture())
		const directory = `environments/released-1`
		f.copy(`local-host`, `${directory}/node_modules/host`)
		f.config.prepareCommand = `true`
		const result = await npmTest(
			f.config,
			{ peer: `host`, range: `1.0.0` },
			{ baseDirectory: f.directory },
		)
		expect(result.exitCode).toBe(2)
		expect(result.representatives[0]!.error).toContain(
			`host@2.0.0 does not match its manifest`,
		)
		expect(result.representatives[0]!.suites).toEqual([])
		assertStagesRemoved(f, result)
	}, 30_000)
})
