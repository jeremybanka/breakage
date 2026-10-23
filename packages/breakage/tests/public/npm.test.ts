import { afterEach, expect, it } from "bun:test"
import { npmCheck, npmTest } from "breakage"

import type { NpmFixture } from "./npm-fixture.ts"
import { assertStagesRemoved, npmFixture } from "./npm-fixture.ts"

let project: NpmFixture | undefined
afterEach(() => project?.clean())

it(`tests every matching peer formulation through consumer imports in the environment`, async () => {
	project = npmFixture()
	project.representative(`oldest`, `1.0.0`)
	project.representative(`newest`, `1.9.0`)
	const report = await npmTest(
		project.config,
		{ peer: `host`, range: `1` },
		{ baseDirectory: project.directory },
	)
	// The fixture's contract observes shared object identity across the consumer
	// and packed integration; a separately installed same-version peer fails it.
	expect(report.exitCode, JSON.stringify(report)).toBe(0)
	expect(
		report.representatives.filter((result) => result.status === `passed`),
	).toHaveLength(2)
	expect(
		report.representatives
			.flatMap((result) => result.suites)
			.every((suite) => suite.status === `passed`),
	).toBe(true)
	assertStagesRemoved(project, report)
}, 30_000)

it(`cannot excuse a failure against a still-supported peer`, async () => {
	project = npmFixture()
	project.representative(`oldest`, `1.0.0`)
	project.representative(`current`, `2.0.0`)
	// Keep the candidate valid but break the shared consumer identity.
	project.copy(`src/broken.ts`, `src/index.ts`)
	project.config.artifact = project.build(`.`)
	project.config.release = {
		version: ({ packageName }) =>
			packageName === `integration` ? `3.0.0` : undefined,
	}

	const report = await npmCheck(project.config, {
		baseDirectory: project.directory,
	})
	expect(report.exitCode, JSON.stringify(report)).toBe(1)
	expect(
		report.representatives.every(
			(result) => result.status === `compatibility-failure`,
		),
	).toBe(true)
	assertStagesRemoved(project, report)
}, 30_000)

it(`requires support and coordinated evidence for a planned local peer release`, async () => {
	project = npmFixture()
	project.representative(`oldest`, `1.0.0`)
	project.representative(`current`, `2.0.0`)
	project.config.release = {
		version: ({ packageName }) =>
			packageName === `host` ? `3.0.0` : undefined,
	}
	const options = { baseDirectory: project.directory }
	const unsupported = await npmCheck(project.config, options)
	expect(unsupported.exitCode).toBe(2)
	expect(unsupported.errors.join()).toContain(
		`does not include its planned local release 3.0.0`,
	)
	project.write(`package.json`, {
		...JSON.parse(project.read(`package.json`)),
		peerDependencies: { host: `*` },
	})
	project.config.artifact = project.pack(`.`)
	const missing = await npmCheck(project.config, options)
	expect(missing.exitCode).toBe(2)
	expect(missing.errors.join()).toContain(
		`No coordinated representative covers planned local peer host@3.0.0`,
	)
	project.representative(`next`, `2.0.0`, true)
	const supported = await npmCheck(project.config, options)
	expect(supported.exitCode, JSON.stringify(supported)).toBe(0)
	expect(
		supported.representatives.every((result) => result.status === `passed`),
	).toBe(true)
	expect(
		supported.representatives.find((result) => result.path.endsWith(`/next`))!
			.peers.host,
	).toMatchObject({ version: `3.0.0`, source: `candidate` })
	assertStagesRemoved(project, supported)
}, 30_000)

it(`validates a coordinated peer's requirement on the package under test`, async () => {
	project = npmFixture()
	project.representative(`next`, `2.0.0`, true)
	project.write(`package.json`, {
		...JSON.parse(project.read(`package.json`)),
		peerDependencies: { host: `^2` },
	})
	project.config.artifact = project.pack(`.`)
	project.config.release = { version: () => `2.0.0` }
	const host = JSON.parse(project.read(`local-host/package.json`))
	for (const range of [`^1`, `^2`]) {
		project.write(`local-host/package.json`, {
			...host,
			peerDependencies: { integration: range },
		})
		project.config.localPeers!.host!.artifact = project.pack(`local-host`)
		for (const coverageOnly of [false, true]) {
			const report = await npmCheck(project.config, {
				baseDirectory: project.directory,
				coverageOnly,
			})
			expect(report.exitCode, JSON.stringify(report)).toBe(
				range === `^1` ? 0 : 2,
			)
			expect(report.representatives[0]!.peers.integration).toMatchObject({
				version: `1.1.0`,
				source: `candidate`,
			})
			if (range === `^2`) {
				expect(report.representatives[0]!.error).toContain(
					`requires integration: ^2, but the representative provides integration@1.1.0`,
				)
			}
			assertStagesRemoved(project, report)
		}
	}
}, 30_000)
