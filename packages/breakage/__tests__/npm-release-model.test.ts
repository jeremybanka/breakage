import path from "node:path"

import { afterEach, expect, it } from "bun:test"
import { defineConfig, npmCheck, semverPolicy } from "breakage"

import {
	assertStagesRemoved,
	npmFixture,
	type NpmFixture,
} from "../tests/public/npm-fixture.ts"

let fixture: NpmFixture | undefined
afterEach(() => {
	fixture?.clean()
	fixture = undefined
})

it.each([
	{ target: `1.1.0`, expected: 1 },
	{ target: `2.0.0`, expected: 0 },
])(
	`shares release policy for npm support drops at $target`,
	async ({ target, expected }) => {
		const f = (fixture = npmFixture())
		delete f.config.localPeers
		f.representative(`one`, `1.0.0`)
		f.representative(`two`, `2.0.0`)
		f.baseline({ host: `^1 || ^2 || ^3` })
		let calls = 0
		const config = defineConfig({
			release: {
				version: ({ packageName, packageDirectory, currentVersion }) => {
					expect(packageName).toBe(`integration`)
					expect(packageDirectory).toBe(f.directory)
					expect(currentVersion).toBe(`1.1.0`)
					calls++
					return target
				},
				policy: semverPolicy({ beforeV1: `minor` }),
			},
			npm: f.config,
		}).npm!
		const result = await npmCheck(config, {
			baseDirectory: f.directory,
			coverageOnly: true,
		})
		expect(result.exitCode, JSON.stringify(result)).toBe(expected)
		expect(result.support.status).toBe(
			expected === 0 ? `breaking-release` : `end-of-support`,
		)
		expect(calls).toBe(1)
		// The manifest supplies the same intent after a release tool consumes its plan.
		f.update(`package.json`, { version: target })
		config.release = { policy: semverPolicy({ beforeV1: `minor` }) }
		const versioned = await npmCheck(config, {
			baseDirectory: f.directory,
			coverageOnly: true,
		})
		expect(versioned.exitCode, JSON.stringify(versioned)).toBe(expected)
		expect(versioned.support.release).toEqual(result.support.release)
		assertStagesRemoved(f, versioned)
	},
	30_000,
)

it(`runs inline npm preparation and suites in their own directories and preserves failures`, async () => {
	const f = (fixture = npmFixture())
	delete f.config.localPeers
	f.representative(`one`, `1.0.0`)
	f.representative(`two`, `2.0.0`)
	f.baseline({ host: `^1 || ^2 || ^3` })
	f.config.release = { version: `2.0.0` }
	const prepare = f.config.prepareCommand
	const install = f.config.installCommand!
	const suite = f.config.suites.host!.command
	if (
		typeof prepare !== `string` ||
		typeof install !== `string` ||
		typeof suite !== `string`
	)
		throw new Error(`Expected fixture commands.`)
	const calls: string[] = []
	const originalCwd = process.cwd()
	f.config.prepareCommand = async ({ cwd, run }) => {
		expect(path.basename(path.dirname(cwd))).toBe(`peer-environments`)
		calls.push(`prepare`)
		return await run(prepare)
	}
	f.config.installCommand = async ({ cwd, run }) => {
		expect(path.basename(cwd)).toBe(`test`)
		calls.push(`install`)
		return await run(install)
	}
	f.config.suites.host!.command = async ({ cwd, run }) => {
		expect(path.basename(cwd)).toBe(`test`)
		expect(process.cwd()).toBe(originalCwd)
		calls.push(`test`)
		return await run(suite)
	}
	f.copy(`contracts/check-released-host-failure.ts`, `contracts/check.ts`)
	const result = await npmCheck(f.config, { baseDirectory: f.directory })
	expect(result.support.status).toBe(`breaking-release`)
	expect(result.exitCode, JSON.stringify(result)).toBe(1)
	expect(result.representatives.map((entry) => entry.status)).toEqual([
		`compatibility-failure`,
		`passed`,
	])
	expect(calls.filter((entry) => entry === `test`)).toHaveLength(2)
	expect(calls).toContain(`prepare`)
	expect(calls).toContain(`install`)
	assertStagesRemoved(f, result)
}, 30_000)

it(`reports invalid release evidence as a setup error`, async () => {
	const f = (fixture = npmFixture())
	delete f.config.localPeers
	f.representative(`one`, `1.0.0`)
	f.representative(`two`, `2.0.0`)
	f.baseline({ host: `^1 || ^2 || ^3` })
	f.config.release = { version: () => `invalid` }
	const result = await npmCheck(f.config, {
		baseDirectory: f.directory,
		coverageOnly: true,
	})
	expect(result.exitCode).toBe(2)
	expect(result.support.status).toBe(`setup-error`)
	assertStagesRemoved(f, result)
}, 30_000)
