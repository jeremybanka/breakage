import { spawnSync } from "node:child_process"
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "bun:test"

let directory: string
beforeEach(() => {
	directory = mkdtempSync(resolve(tmpdir(), `breakage-cli-`))
})
afterEach(() => {
	rmSync(directory, { recursive: true, force: true })
})

function runCli(command: string, args: string[]) {
	const result = spawnSync(
		`node`,
		[resolve(import.meta.dirname, `../dist/${command}.x.js`), ...args],
		{
			cwd: directory,
			encoding: `utf8`,
			timeout: 10000,
			env: { ...process.env, NO_COLOR: `1`, XDG_CACHE_HOME: directory },
		},
	)
	expect(result.error).toBeUndefined()
	expect(result.status, result.stderr).toBe(0)
	return result
}

describe(`CLI features`, () => {
	it(`generates all shell integrations without validating configuration`, () => {
		writeFileSync(resolve(directory, `breakage.config.json`), `invalid json`)
		for (const target of [`bash`, `zsh`, `fish`, `nushell`, `carapace`]) {
			const result = runCli(`breakage`, [`completion`, target])
			expect(result.stdout).toContain(`breakage`)
			expect(result.stderr).toBe(``)
		}
		expect(readdirSync(directory)).toEqual([`breakage.config.json`])
	})
	it.each([
		`--test-command`,
		`--pattern`,
		`--tag-pattern`,
		`--base-dir`,
		`--baseline-file`,
	])(`offers %s before validating required options`, (option) => {
		const result = runCli(`breakage`, [`__complete`, option])
		expect(result.stdout).toContain(option)
		expect(result.stderr).toBe(``)
	})
	it(`completes config files and directory values`, () => {
		mkdirSync(resolve(directory, `sample-dir`))
		writeFileSync(resolve(directory, `sample.json`), `{}`)
		expect(
			runCli(`breakage`, [`_carapace`, `export`, `breakage`, `sam`]).stdout,
		).toContain(`sample.json`)
		for (const words of [[`--base-dir=sam`], [`schema`, `--out-dir=sam`]]) {
			const result = runCli(`breakage`, [
				`_carapace`,
				`export`,
				`breakage`,
				...words,
			])
			expect(result.stdout).toContain(`sample-dir/`)
			expect(result.stdout).not.toContain(`sample.json`)
		}
	})
	it(`completes prelude options and snapshot paths without loading config`, () => {
		writeFileSync(resolve(directory, `breakage.config.json`), `invalid json`)
		writeFileSync(resolve(directory, `sample.json`), `{}`)
		for (const words of [[`--baseline-file=sam`], [`prelude`, `--out=sam`]]) {
			expect(
				runCli(`breakage`, [`_carapace`, `export`, `breakage`, ...words])
					.stdout,
			).toContain(`sample.json`)
		}
		expect(
			runCli(`breakage`, [`__complete`, `prelude`, `--o`]).stdout,
		).toContain(`--out`)
	})
	it(`accepts the output alias and warns about ignored options before schema generation`, () => {
		const result = runCli(`breakage`, [
			`schema`,
			`--out-dir=${directory}`,
			`--test-command=true`,
			`--typo`,
		])
		expect(existsSync(resolve(directory, `breakage.main.schema.json`))).toBe(
			true,
		)
		const schema = JSON.parse(
			readFileSync(resolve(directory, `breakage.main.schema.json`), `utf8`),
		) as { properties: Record<string, unknown> }
		expect(schema.properties).toHaveProperty(`test`)
		expect(schema.properties).toHaveProperty(`release`)
		expect(schema.properties).not.toHaveProperty(`certifyCommand`)
		expect(result.stderr).toContain(`Option "--test-command" is not valid`)
		expect(result.stderr).toContain(`Unknown option "--typo"`)
		expect(result.stderr).not.toContain(`--out-dir`)
		expect(result.stdout).not.toContain(`Warning:`)
	})
})
