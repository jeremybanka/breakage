// cspell:words relase polciy comand
import { rejects } from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

import { afterEach, beforeEach, expect, it } from "bun:test"
import { defineConfig, type BreakageConfig, type NpmConfig } from "breakage"

import { loadConfig } from "../src/config.ts"

const npm: NpmConfig = {
	artifact: `package.tgz`,
	representatives: `peers/*`,
	lockfile: `package-lock.json`,
	prepareCommand: `npm ci`,
	suites: { host: { files: [`test.ts`], command: `node test.ts` } },
	baseline: { firstRelease: true },
}
let directory: string
beforeEach(() => {
	directory = mkdtempSync(path.join(tmpdir(), `breakage-config-`))
	cpSync(new URL(`./fixtures/config`, import.meta.url), directory, {
		recursive: true,
	})
})
afterEach(() => rmSync(directory, { recursive: true, force: true }))

function writeOptions(options: unknown): void {
	writeFileSync(
		path.join(directory, `config-data.json`),
		JSON.stringify({ options }),
	)
}

function run(args: string[], built = false) {
	return spawnSync(
		built ? `node` : process.execPath,
		[
			path.resolve(
				import.meta.dirname,
				built ? `../dist/breakage.x.js` : `../src/breakage.x.ts`,
			),
			...args,
		],
		{
			cwd: directory,
			encoding: `utf8`,
			env: { ...process.env, NO_COLOR: `1` },
			timeout: 10_000,
		},
	)
}

function capture(args: string[]): BreakageConfig {
	const result = spawnSync(
		process.execPath,
		[
			`--preload`,
			path.resolve(import.meta.dirname, `fixtures/capture-cli-options.ts`),
			path.resolve(import.meta.dirname, `../src/breakage.x.ts`),
			...args,
		],
		{ cwd: directory, encoding: `utf8`, timeout: 10_000 },
	)
	expect(result.status, result.stdout + result.stderr).toBe(0)
	return JSON.parse(result.stderr) as BreakageConfig
}

it.each([
	{
		config: { test: `old` },
		flag: `-t=new`,
		selected: `testCommand`,
		removed: `test`,
	},
	{
		config: { test: `old` },
		flag: `--test-command=new`,
		selected: `testCommand`,
		removed: `test`,
	},
	{
		config: { testCommand: `old` },
		flag: `--test=new`,
		selected: `test`,
		removed: `testCommand`,
	},
] as const)(
	`lets $flag override the other command spelling`,
	({ config, flag, selected, removed }) => {
		writeOptions({ ...config, testPattern: `*.ts` })
		const parsed = capture([flag])
		expect(parsed[selected]).toBe(`new`)
		expect(parsed[removed]).toBeUndefined()
	},
)

it(`keeps config-relative paths, caller-relative directory overrides, and boolean values`, () => {
	writeOptions({
		baseDirname: `library`,
		testPattern: `*.ts`,
		test: `true`,
		verbose: true,
	})
	cpSync(
		new URL(`./fixtures/config`, import.meta.url),
		path.join(directory, `config-copy`),
		{ recursive: true },
	)
	cpSync(
		path.join(directory, `config-data.json`),
		path.join(directory, `config-copy/config-data.json`),
	)
	const filename = `config-copy/breakage.config.ts`
	expect(capture([filename]).baseDirname).toBe(
		path.join(directory, `config-copy/library`),
	)
	const parsed = capture([filename, `--base-dir=override`, `--verbose=false`])
	expect(parsed.baseDirname).toBe(path.join(directory, `override`))
	expect(parsed.verbose).toBe(false)
})

it(`rejects two explicitly supplied command spellings`, () => {
	writeOptions({ testPattern: `*.ts` })
	const result = run([`--test=true`, `--test-command=false`])
	expect(result.status).toBe(2)
	expect(result.stderr).toContain(`Choose test or testCommand, not both.`)
})

it.each([
	{ options: { relase: {} }, key: `relase` },
	{ options: { release: { polciy: false } }, key: `polciy` },
	{ options: { npm: { ...npm, relase: {} } }, key: `relase` },
	{ options: { npm: { ...npm, release: { polciy: false } } }, key: `polciy` },
	{
		options: {
			npm: { ...npm, suites: { host: { ...npm.suites.host, comand: `true` } } },
		},
		key: `comand`,
	},
	{
		options: {
			npm: {
				...npm,
				localPeers: {
					host: { directory: `.`, artifact: `host.tgz`, release: {} },
				},
			},
		},
		key: `release`,
	},
	{
		options: {
			npm: { ...npm, baseline: { firstRelease: true, tagPattern: `host@` } },
		},
		key: `baseline`,
	},
])(
	`rejects unknown config keys through every entrypoint: $key`,
	async ({ options, key }) => {
		expect(() => defineConfig(options as BreakageConfig)).toThrow(key)
		writeOptions(options)
		await rejects(
			loadConfig(path.join(directory, `breakage.config.ts`)),
			(error: unknown) => error instanceof Error && error.message.includes(key),
		)
		for (const args of [
			[],
			[`prelude`],
			[`npm`, `check`, `--config=breakage.config.ts`, `--json`],
		]) {
			const result = run(args)
			expect(result.error).toBeUndefined()
			expect(result.status, result.stdout + result.stderr).toBe(2)
			expect(result.stdout + result.stderr).toContain(key)
		}
	},
)

it(`preserves async resolver and policy identities without invoking them, including inherited npm hooks`, async () => {
	writeOptions({ npm, baseDirname: `nested` })
	const filename = path.join(directory, `hooks.config.ts`)
	const loaded = await loadConfig(filename)
	const hooks = await import(pathToFileURL(filename).href)
	expect(loaded.release?.resolveDelta).toBe(hooks.resolveDelta)
	expect(loaded.release?.policy).toBe(hooks.policy)
	expect(loaded.npm?.release).toBe(loaded.release)
	expect(loaded.baseDirname).toBe(path.join(directory, `nested`))
})

it.each([false, true])(
	`validates raw configuration before overrides (built Node CLI: %s)`,
	(built) => {
		writeOptions({ test: false, testPattern: `*.ts` })
		const result = run([`--test=true`], built)
		expect(result.status).toBe(2)
		expect(result.stderr).toContain(`test must be a string`)
	},
)

it.each([
	`--release={}`,
	`--release.policy=true`,
	`--npm={}`,
	`--npm.release.policy=true`,
])(`reserves config-only flag %s`, (flag) => {
	for (const args of [[flag], [`prelude`, flag], [`npm`, `check`, flag]]) {
		const result = run(args)
		expect(result.status).toBe(2)
		expect(result.stderr).toContain(`config-only`)
	}
})

it(`keeps config-only options out of help and completions`, () => {
	for (const args of [
		[`help`],
		[`__complete`, `--`],
		[`__complete`, `prelude`, `--`],
		[`__complete`, `npm`, `check`, `--`],
	]) {
		const result = run(args)
		expect(result.status, result.stderr).toBe(0)
		expect(result.stdout).not.toContain(`--release`)
		expect(result.stdout).not.toContain(`--npm`)
	}
})

it(`reports explicit missing configuration paths`, () => {
	for (const args of [
		[`missing.ts`],
		[`prelude`, `missing.ts`],
		[`npm`, `check`, `--config=missing.ts`],
	]) {
		const result = run(args)
		expect(result.status).toBe(2)
		expect(result.stdout + result.stderr).toContain(
			`Configuration file does not exist`,
		)
	}
})

it(`catches misspelled keys in typed literals and untyped function hooks`, () => {
	// @ts-expect-error Unknown root keys must be diagnosed while authoring.
	expect(() => defineConfig({ relase: {} })).toThrow(`relase`)
	expect(() =>
		defineConfig({
			release: {
				// @ts-expect-error A misspelled policy must not silently use the default.
				polciy: () => false,
			},
		}),
	).toThrow(`polciy`)
	expect(() =>
		defineConfig({
			npm: {
				...npm,
				release: {
					// @ts-expect-error npm release hooks have the same strict authoring contract.
					polciy: () => false,
				},
			},
		}),
	).toThrow(`polciy`)
})

it(`contextually types hook inputs and results from the config declaration`, () => {
	const config = {
		release: {
			resolveDelta: async ({ baseline, currentVersion }) => ({
				previousVersion: baseline?.version ?? currentVersion,
				version: currentVersion,
				delta: `none`,
			}),
			policy: ({ delta }) => delta === `major`,
		},
	} satisfies BreakageConfig
	expect(defineConfig(config).release?.resolveDelta).toBe(
		config.release.resolveDelta,
	)
	defineConfig({
		release: {
			// @ts-expect-error Resolvers return transitions, not version strings.
			resolveDelta: () => `1.0.0`,
			// @ts-expect-error Policies are synchronous predicates.
			policy: async () => true,
		},
	})
})
