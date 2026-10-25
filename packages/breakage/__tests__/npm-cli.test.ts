import { spawnSync } from "node:child_process"
import path from "node:path"

import { afterEach, describe, expect, it } from "bun:test"

import type { NpmReport } from "../src/npm/types.ts"
import type { NpmFixture } from "../tests/public/npm-fixture.ts"
import { npmFixture } from "../tests/public/npm-fixture.ts"

let fixture: NpmFixture | undefined
afterEach(() => {
	fixture?.clean()
	fixture = undefined
})

function cli(
	directory: string,
	...args: string[]
): { status: number | null; stdout: string; stderr: string } {
	const result = spawnSync(
		`node`,
		[path.resolve(import.meta.dirname, `../dist/breakage.x.js`), ...args],
		{
			cwd: directory,
			encoding: `utf8`,
			timeout: 30_000,
		},
	)
	expect(result.error).toBeUndefined()
	return result
}

describe(`packaged npm CLI`, () => {
	it(`loads TypeScript hooks, follows config-relative paths, and reports conditional execution as JSON`, () => {
		const f = (fixture = npmFixture())
		f.representative(`next`, `2.0.0`, true)
		f.write(`breakage.config.json`, `invalid json that must not win`)
		f.write(`fixture-config.json`, f.config)
		f.copy(`release-intent.config.ts`, `breakage.config.ts`)
		const result = cli(f.directory, `npm`, `test`, `host`, `3`, `--json`)
		expect(result.status, result.stdout + result.stderr).toBe(0)
		const report = JSON.parse(result.stdout) as NpmReport
		expect(report.representatives[0]!.peers.host!.source).toBe(`candidate`)
		expect(report.mode).toBe(`test`)
		const explicit = cli(
			path.dirname(f.directory),
			`npm`,
			`test`,
			`--representative`,
			`peer-environments/next`,
			`--config`,
			path.join(f.directory, `breakage.config.ts`),
		)
		expect(explicit.status, explicit.stdout + explicit.stderr).toBe(0)
		expect(explicit.stdout).toContain(`conditional on publication`)
	}, 30_000)
	it(`awaits TypeScript audit configuration and exposes missing coverage as exit 2`, () => {
		const f = (fixture = npmFixture())
		f.representative(`one`, `1.0.0`)
		f.copy(`data.config.ts`, `custom.config.ts`)
		f.write(`fixture-config.json`, { npm: f.config })
		const result = cli(
			f.directory,
			`npm`,
			`check`,
			`--coverage-only`,
			`--config`,
			`custom.config.ts`,
			`--json`,
		)
		expect(result.status, result.stdout + result.stderr).toBe(2)
		const report = JSON.parse(result.stdout) as NpmReport
		expect(report.mode).toBe(`coverage-only`)
		expect(report.errors.join()).toContain(`^2`)
		expect(report.representatives[0]!.status).toBe(`audited`)
	}, 30_000)
	it(`reports malformed configuration and invalid selection without running tests`, () => {
		const f = (fixture = npmFixture())
		f.copy(`data.config.ts`, `breakage.config.ts`)
		f.write(`fixture-config.json`, { npm: {} })
		const bad = cli(f.directory, `npm`, `check`, `--json`)
		expect(bad.status).toBe(2)
		expect(JSON.parse(bad.stdout).errors[0]).toContain(`artifact`)
		f.write(`fixture-config.json`, { npm: f.config })
		const missing = cli(f.directory, `npm`, `test`, `--json`)
		expect(missing.status).toBe(2)
		expect(JSON.parse(missing.stdout).errors[0]).toContain(
			`npm test <peer> <range>`,
		)
	}, 30_000)
	it(`offers npm completion without loading executable configuration`, () => {
		const f = (fixture = npmFixture())
		f.copy(`throwing.config.ts`, `breakage.config.ts`)
		const result = cli(f.directory, `__complete`, `npm`, ``)
		expect(result.status, result.stderr).toBe(0)
		expect(result.stdout).toContain(`check`)
		expect(result.stdout).toContain(`test`)
	}, 30_000)
})
