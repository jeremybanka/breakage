import { afterEach, describe, expect, it } from "bun:test"

import { npmCheck, npmTest } from "../src/npm/check.ts"
import type { NpmFixture } from "../tests/public/npm-fixture.ts"
import { assertStagesRemoved, npmFixture } from "../tests/public/npm-fixture.ts"

let fixture: NpmFixture | undefined
afterEach(() => {
	fixture?.clean()
	fixture = undefined
})

function setup(range: string): NpmFixture {
	const f = (fixture = npmFixture())
	f.write(`package.json`, {
		...JSON.parse(f.read(`package.json`)),
		peerDependencies: { host: range },
	})
	f.write(`local-host/package.json`, {
		...JSON.parse(f.read(`local-host/package.json`)),
		version: `0.53.3`,
	})
	f.config.artifact = f.pack(`.`)
	f.config.localPeers!.host!.artifact = f.pack(`local-host`)
	f.config.releaseIntent = ({ packageName }) =>
		packageName === `host`
			? { status: `release`, version: `0.54.0` }
			: { status: `none` }
	return f
}

for (const coverageOnly of [false, true]) {
	describe(`planned local releases (coverage only: ${coverageOnly})`, () => {
		it.each([`^0.54.0`, `0.54.0`, `*`, `>=0.53.3 <1`])(
			`accepts semver membership in %s`,
			async (range) => {
				const f = setup(range)
				f.representative(`next`, `0.53.3`, true)
				let calls = 0
				f.config.releaseIntent = ({ packageName, currentVersion }) => {
					expect(packageName).toBe(`host`)
					expect(currentVersion).toBe(`0.53.3`)
					calls++
					return { status: `release`, version: `0.54.0` }
				}
				if (coverageOnly) f.config.artifact = `not-built.tgz`
				const result = await npmCheck(f.config, {
					baseDirectory: f.directory,
					coverageOnly,
				})
				expect(result.exitCode, JSON.stringify(result)).toBe(0)
				expect(calls).toBe(1)
				expect(result.representatives[0]!.peers.host).toMatchObject({
					version: `0.54.0`,
					source: `candidate`,
				})
				expect(result.representatives[0]!.suites[0]!.status).toBe(
					coverageOnly ? `not-run` : `passed`,
				)
				expect(JSON.parse(f.read(`local-host/package.json`)).version).toBe(
					`0.53.3`,
				)
				assertStagesRemoved(f, result)
			},
			30_000,
		)
		it(`fails an excluded intended version even when released coverage passes`, async () => {
			const f = setup(`^0.53.3`)
			f.representative(`released`, `0.53.3`)
			f.representative(`next`, `0.53.3`, true)
			f.baseline({ host: `^0.53.3` })
			const result = await npmCheck(f.config, {
				baseDirectory: f.directory,
				coverageOnly,
			})
			expect(result.exitCode).toBe(2)
			expect(result.support.status).toBe(`unchanged`)
			expect(result.errors.join()).toContain(
				`Declared support for host: ^0.53.3 does not include its planned local release 0.54.0`,
			)
			expect(
				result.representatives.find((entry) =>
					entry.path.endsWith(`/released`),
				)!.status,
			).toBe(coverageOnly ? `audited` : `passed`)
			assertStagesRemoved(f, result)
		}, 30_000)
		it(`requires a candidate even when an installed peer has the intended version`, async () => {
			const f = setup(`*`)
			f.representative(`installed`, `0.54.0`)
			const result = await npmCheck(f.config, {
				baseDirectory: f.directory,
				coverageOnly,
			})
			expect(result.exitCode).toBe(2)
			expect(result.errors.join()).toContain(
				`No coordinated representative covers planned local peer host@0.54.0`,
			)
			expect(result.representatives[0]!.status).toBe(
				coverageOnly ? `audited` : `passed`,
			)
			assertStagesRemoved(f, result)
		}, 30_000)
	})
}

it.each([`none`, `throws`, `invalid`, `older`])(
	`handles %s release intent without a candidate representative`,
	async (scenario) => {
		const f = setup(`^0.53.3`)
		f.representative(`released`, `0.53.3`)
		let calls = 0
		f.config.releaseIntent = () => {
			calls++
			if (scenario === `throws`) throw new Error(`release plan unavailable`)
			return scenario === `none`
				? { status: `none` }
				: {
						status: `release`,
						version: scenario === `older` ? `0.52.0` : `invalid`,
					}
		}
		const result = await npmCheck(f.config, {
			baseDirectory: f.directory,
			coverageOnly: true,
		})
		expect(result.exitCode, JSON.stringify(result)).toBe(
			scenario === `none` ? 0 : 2,
		)
		expect(calls).toBe(1)
		if (scenario !== `none`)
			expect(result.errors.join()).toContain(
				`Cannot inspect planned local release for host`,
			)
		expect(result.representatives[0]!.status).toBe(`audited`)
		assertStagesRemoved(f, result)
	},
	30_000,
)

it(`validates registered peer identity even without candidate enrollment`, async () => {
	const f = setup(`*`)
	f.representative(`released`, `0.53.3`)
	f.write(`local-host/package.json`, {
		name: `another-package`,
		version: `0.53.3`,
	})
	const result = await npmCheck(f.config, {
		baseDirectory: f.directory,
		coverageOnly: true,
	})
	expect(result.exitCode).toBe(2)
	expect(result.errors.join()).toContain(
		`Local peer identity mismatch for host`,
	)
}, 30_000)

it(`only inspects currently declared registered local peers, including optional peers`, async () => {
	const f = setup(`^0.53.3`)
	f.representative(`released`, `0.53.3`)
	f.config.localPeers!.historical = {
		directory: `local-host`,
		artifact: `unused.tgz`,
	}
	f.write(`package.json`, {
		...JSON.parse(f.read(`package.json`)),
		peerDependenciesMeta: { host: { optional: true } },
	})
	const inspected: string[] = []
	f.config.releaseIntent = ({ packageName }) => {
		inspected.push(packageName)
		return { status: `release`, version: `0.54.0` }
	}
	const result = await npmCheck(f.config, {
		baseDirectory: f.directory,
		coverageOnly: true,
	})
	expect(result.exitCode).toBe(2)
	expect(inspected).toEqual([`host`])
	expect(result.errors.join()).toContain(
		`does not include its planned local release 0.54.0`,
	)
}, 30_000)

it(`does not certify away a missing planned version when certifying dropped historical support`, async () => {
	const f = setup(`^0.53.3`)
	f.representative(`released`, `0.53.3`)
	f.baseline({ host: `^0.52.0 || ^0.53.3` })
	f.config.releaseIntent = ({ packageName }) => ({
		status: `release`,
		version: packageName === `host` ? `0.54.0` : `2.0.0`,
	})
	f.config.certifyBreaking = () => true
	const result = await npmCheck(f.config, {
		baseDirectory: f.directory,
		coverageOnly: true,
	})
	expect(result.support.status).toBe(`certified`)
	expect(result.exitCode).toBe(2)
	expect(result.errors.join()).toContain(
		`does not include its planned local release 0.54.0`,
	)
}, 30_000)

it(`preserves compatibility failures when a declared coordinated candidate fails its suite`, async () => {
	const f = setup(`*`)
	f.representative(`released`, `0.53.3`)
	f.representative(`next`, `0.53.3`, true)
	f.config.certifyBreaking = () => true
	f.copy(
		new URL(
			`./fixtures/npm/environment/check-candidate-failure.ts`,
			import.meta.url,
		),
		`contracts/check.ts`,
	)
	const result = await npmCheck(f.config, { baseDirectory: f.directory })
	expect(result.exitCode, JSON.stringify(result)).toBe(1)
	expect(result.errors).toEqual([])
	expect(
		result.representatives.find((entry) => entry.path.endsWith(`/next`))!
			.status,
	).toBe(`compatibility-failure`)
	expect(
		result.representatives.find((entry) => entry.path.endsWith(`/released`))!
			.status,
	).toBe(`passed`)
	assertStagesRemoved(f, result)
}, 30_000)

it(`keeps focused exploration available outside declared support`, async () => {
	const f = setup(`^0.53.3`)
	f.representative(`next`, `0.53.3`, true)
	const result = await npmTest(
		f.config,
		{ peer: `host`, range: `0.54.0` },
		{ baseDirectory: f.directory },
	)
	expect(result.exitCode, JSON.stringify(result)).toBe(0)
	expect(result.representatives[0]!.warnings).toContain(
		`host@0.54.0 is outside declared support.`,
	)
	expect(result.support.status).toBe(`not-checked`)
	assertStagesRemoved(f, result)
}, 30_000)
