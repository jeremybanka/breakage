import { mkdirSync, symlinkSync } from "node:fs"
import path from "node:path"

import { afterEach, describe, expect, it } from "bun:test"

import { npmTest } from "../src/npm/check.ts"
import type { NpmFixture } from "../tests/public/npm-fixture.ts"
import { assertStagesRemoved, npmFixture } from "../tests/public/npm-fixture.ts"

let fixture: NpmFixture | undefined
afterEach(() => {
	fixture?.clean()
	fixture = undefined
})

function setup(): NpmFixture {
	fixture = npmFixture(
		new URL(`./fixtures/npm/runtime-dependencies/`, import.meta.url),
		(project) => project.copy(`src/with-helper.ts`, `src/index.ts`),
	)
	return fixture
}

describe(`runtime installation boundaries`, () => {
	it.each([false, true])(
		`rejects checkout dependency fallback (optional: %s)`,
		async (optional) => {
			const f = setup()
			if (!optional) {
				f.update(`package.json`, {
					dependencies: JSON.parse(f.read(`package.json`)).optionalDependencies,
					optionalDependencies: {},
				})
				f.config.artifact = f.pack(`.`)
			}
			f.copy(`helper`, `node_modules/helper`)
			symlinkSync(
				`../environments/released-1/node_modules/host`,
				path.join(f.directory, `node_modules/host`),
			)
			f.config.installCommand += optional
				? ` --omit=optional`
				: ` && rm -r node_modules/helper`
			const result = await npmTest(
				f.config,
				{ representative: `environments/released-1` },
				{ baseDirectory: f.directory },
			)
			expect(result.exitCode, JSON.stringify(result)).toBe(2)
			expect(result.representatives[0]!.error).toContain(
				`helper resolves outside the representative installation`,
			)
			expect(result.representatives[0]!.suites[0]!.status).toBe(`not-run`)
			assertStagesRemoved(f, result)
		},
		30_000,
	)

	it.each([false, true])(
		`checks linked store dependencies without accepting store ancestors (ancestor: %s)`,
		async (ancestor) => {
			const f = setup()
			const store = `.store/helper-1/node_modules`
			f.copy(`helper`, `${store}/helper`)
			f.update(`${store}/helper/package.json`, {
				optionalDependencies: { leaf: `1.0.0` },
			})
			const leaf = ancestor ? `.store/node_modules/leaf` : `${store}/leaf`
			f.copy(`released-host`, leaf)
			f.update(`${leaf}/package.json`, { name: `leaf` })
			symlinkSync(
				path.join(f.directory, `environments/released-1/node_modules/host`),
				path.join(f.directory, store, `host`),
			)
			f.config.installCommand += ` --omit=optional && ln -s ../../../../${store}/helper node_modules/helper`
			const result = await npmTest(
				f.config,
				{ representative: `environments/released-1` },
				{ baseDirectory: f.directory },
			)
			expect(result.exitCode, JSON.stringify(result)).toBe(ancestor ? 2 : 0)
			if (ancestor)
				expect(result.representatives[0]!.error).toContain(
					`leaf resolves outside the representative installation`,
				)
			else expect(result.representatives[0]!.suites[0]!.status).toBe(`passed`)
			assertStagesRemoved(f, result)
		},
		30_000,
	)

	it(`accepts a representative's explicit dependency link into a store`, async () => {
		const f = setup()
		f.copy(`helper`, `.store/node_modules/helper`)
		symlinkSync(
			path.join(f.directory, `environments/released-1/node_modules/host`),
			path.join(f.directory, `.store/node_modules/host`),
		)
		mkdirSync(path.join(f.directory, `environments/released-1/node_modules`), {
			recursive: true,
		})
		f.config.prepareCommand += ` && ln -s ../../../.store/node_modules/helper node_modules/helper`
		f.config.installCommand += ` --omit=optional`
		const result = await npmTest(
			f.config,
			{ representative: `environments/released-1` },
			{ baseDirectory: f.directory },
		)
		expect(result.exitCode, JSON.stringify(result)).toBe(0)
		expect(result.representatives[0]!.suites[0]!.status).toBe(`passed`)
		assertStagesRemoved(f, result)
	}, 30_000)
})
