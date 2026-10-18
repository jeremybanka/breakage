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

it(`cannot certify away a failure against a still-supported peer`, async () => {
	project = npmFixture()
	project.representative(`oldest`, `1.0.0`)
	project.representative(`current`, `2.0.0`)
	// Keep the candidate valid but break the shared consumer identity.
	project.write(`index.js`, `export const host = {};`)
	project.config.artifact = project.pack(`.`)
	project.config.releaseIntent = () => ({ status: `release`, version: `3.0.0` })
	project.config.certifyBreaking = () => true
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
