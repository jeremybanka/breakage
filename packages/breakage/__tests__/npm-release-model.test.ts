import { afterEach, expect, it } from "bun:test"
import {
	versionTransition,
	defineConfig,
	npmCheck,
	semverPolicy,
} from "breakage"

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
				resolveDelta: ({
					packageName,
					packageDirectory,
					currentVersion,
					baseline,
				}) => {
					expect(packageName).toBe(`integration`)
					expect(packageDirectory).toBe(f.directory)
					expect(currentVersion).toBe(`1.1.0`)
					expect(baseline?.version).toBe(`1.0.0`)
					calls++
					return versionTransition(baseline?.version ?? currentVersion, target)
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

it(`preserves shell suite failures despite a breaking release`, async () => {
	const f = (fixture = npmFixture())
	delete f.config.localPeers
	f.representative(`one`, `1.0.0`)
	f.representative(`two`, `2.0.0`)
	f.baseline({ host: `^1 || ^2 || ^3` })
	f.config.release = {
		resolveDelta: ({ baseline, currentVersion }) => {
			return versionTransition(baseline?.version ?? currentVersion, `2.0.0`)
		},
	}
	f.copy(`contracts/check-released-host-failure.ts`, `contracts/check.ts`)
	const result = await npmCheck(f.config, { baseDirectory: f.directory })
	expect(result.support.status).toBe(`breaking-release`)
	expect(result.exitCode, JSON.stringify(result)).toBe(1)
	expect(result.representatives.map((entry) => entry.status)).toEqual([
		`compatibility-failure`,
		`passed`,
	])
	assertStagesRemoved(f, result)
}, 30_000)

it(`reports invalid release evidence as a setup error`, async () => {
	const f = (fixture = npmFixture())
	delete f.config.localPeers
	f.representative(`one`, `1.0.0`)
	f.representative(`two`, `2.0.0`)
	f.baseline({ host: `^1 || ^2 || ^3` })
	f.config.release = {
		resolveDelta: ({ baseline, currentVersion }) => {
			return versionTransition(baseline?.version ?? currentVersion, `invalid`)
		},
	}
	const result = await npmCheck(f.config, {
		baseDirectory: f.directory,
		coverageOnly: true,
	})
	expect(result.exitCode).toBe(2)
	expect(result.support.status).toBe(`setup-error`)
	assertStagesRemoved(f, result)
}, 30_000)

it(`rejects an npm support transition against a different baseline`, async () => {
	const f = (fixture = npmFixture())
	delete f.config.localPeers
	f.representative(`one`, `1.0.0`)
	f.representative(`two`, `2.0.0`)
	f.baseline({ host: `^1 || ^2 || ^3` })
	f.config.release = {
		resolveDelta: () => versionTransition(`0.1.0`, `2.0.0`),
		policy: () => true,
	}
	const result = await npmCheck(f.config, {
		baseDirectory: f.directory,
		coverageOnly: true,
	})
	expect(result.exitCode).toBe(2)
	expect(result.support).toMatchObject({ status: `setup-error` })
	if (result.support.status === `setup-error`)
		expect(result.support.error).toContain(
			`does not match the selected baseline`,
		)
	assertStagesRemoved(f, result)
}, 30_000)
