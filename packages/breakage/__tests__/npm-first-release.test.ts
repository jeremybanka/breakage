import { afterEach, expect, it } from "bun:test"
import { rmSync } from "node:fs"
import path from "node:path"

import { npmCheck } from "../src/npm/check.ts"
import type { NpmConfig } from "../src/npm/types.ts"
import {
	git,
	npmFixture,
	type NpmFixture,
} from "../tests/public/npm-fixture.ts"

let fixture: NpmFixture | undefined
afterEach(() => {
	fixture?.clean()
	fixture = undefined
})

const baselines: NpmConfig[`baseline`][] = [
	{},
	{ tagPattern: `refs/tags/integration@` },
]

it.each(baselines)(
	`discovers first publication and detects dropped prerelease support with unchanged config %j`,
	async (baseline) => {
		const f = (fixture = npmFixture())
		f.config.baseline = baseline
		f.update(`package.json`, {
			version: `0.1.1`,
			peerDependencies: { host: `^1.9.0 || 2.0.0-rc.17` },
		})
		f.representative(`stable`, `1.9.0`)
		f.representative(`rc`, `2.0.0-rc.17`)
		const options = { baseDirectory: f.directory, coverageOnly: true }
		const initial = await npmCheck(f.config, options)
		expect(initial.exitCode, JSON.stringify(initial)).toBe(0)
		expect(initial.support).toEqual({ status: `first-release`, changes: [] })

		git(f.directory, `add`, `package.json`)
		git(f.directory, `commit`, `-m`, `First publication`)
		git(f.directory, `tag`, `-a`, `integration@0.1.1`, `-m`, `Release`)
		git(f.directory, `push`, `origin`, `--tags`)
		const published = await npmCheck(f.config, options)
		expect(published.exitCode, JSON.stringify(published)).toBe(0)
		expect(published.support).toEqual({
			status: `unchanged`,
			previousVersion: `0.1.1`,
			changes: [],
		})

		f.update(`package.json`, {
			peerDependencies: { host: `^1.9.0 || 2.0.0-rc.18` },
		})
		rmSync(path.join(f.directory, `peer-environments/rc/node_modules`), {
			recursive: true,
		})
		f.representative(`rc`, `2.0.0-rc.18`)
		const narrowed = await npmCheck(f.config, options)
		expect(narrowed.exitCode, JSON.stringify(narrowed)).toBe(1)
		expect(narrowed.errors).toEqual([])
		expect(narrowed.support).toEqual({
			status: `end-of-support`,
			previousVersion: `0.1.1`,
			changes: [
				{
					peer: `host`,
					reason: `narrowed-range`,
					previous: `^1.9.0 || 2.0.0-rc.17`,
					current: `^1.9.0 || 2.0.0-rc.18`,
				},
			],
		})
		expect(f.config.baseline).toBe(baseline)
	},
	30_000,
)

it.each([
	`missing-origin`,
	`unavailable-origin`,
	`invalid-pattern`,
	`invalid-manifest`,
])(
	`reports %s as a setup error instead of first release`,
	async (failure) => {
		const f = (fixture = npmFixture())
		f.config.baseline = {}
		if (failure === `missing-origin`)
			git(f.directory, `remote`, `remove`, `origin`)
		if (failure === `unavailable-origin`)
			git(
				f.directory,
				`remote`,
				`set-url`,
				`origin`,
				`${f.directory}/missing.git`,
			)
		if (failure === `invalid-pattern`) f.config.baseline = { tagPattern: `[` }
		if (failure === `invalid-manifest`) {
			git(f.directory, `add`, `package.json`)
			git(f.directory, `commit`, `-m`, `Initial package`)
			const current = f.read(`package.json`)
			f.write(`package.json`, `{ invalid`)
			git(f.directory, `add`, `package.json`)
			git(f.directory, `commit`, `-m`, `Malformed release manifest`)
			git(f.directory, `tag`, `integration@1.0.0`)
			git(f.directory, `push`, `origin`, `--tags`)
			f.write(`package.json`, current)
		}
		const result = await npmCheck(f.config, {
			baseDirectory: f.directory,
			coverageOnly: true,
		})
		expect(result.exitCode).toBe(2)
		expect(result.support.status).toBe(`setup-error`)
		expect(result.support.error).toBeTruthy()
	},
	30_000,
)

it(`ignores unpublished local tags and unrelated remote tags for a package-specific history`, async () => {
	const f = (fixture = npmFixture())
	f.config.baseline = { tagPattern: `refs/tags/integration@` }
	git(f.directory, `add`, `package.json`)
	git(f.directory, `commit`, `-m`, `Local candidate`)
	git(f.directory, `tag`, `integration@1.0.0`)
	git(f.directory, `tag`, `other@9.0.0`)
	git(f.directory, `push`, `origin`, `refs/tags/other@9.0.0`)
	const result = await npmCheck(f.config, {
		baseDirectory: f.directory,
		coverageOnly: true,
	})
	expect(result.exitCode, JSON.stringify(result)).toBe(0)
	expect(result.support.status).toBe(`first-release`)
}, 30_000)
