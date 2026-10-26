import { strict as assert } from "node:assert"
import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"
import path from "node:path"
import { loadConfig, resolveReleaseDelta, versionTransition } from "breakage"

const require = createRequire(import.meta.url)
for (const peer of [
	`@breakage/changesets`,
	`@changesets/assemble-release-plan`,
	`@changesets/config`,
	`@changesets/pre`,
	`@changesets/read`,
	`@manypkg/get-packages`,
]) {
	assert.throws(() => require.resolve(peer), { code: `MODULE_NOT_FOUND` })
}
assert.throws(() => require.resolve(`breakage/changesets`), {
	code: `MODULE_NOT_FOUND`,
})
const config = await loadConfig(path.resolve(`breakage.config.ts`))
assert.equal(config.test, `node --test public/*.ts`)
assert.deepEqual(
	await resolveReleaseDelta(config.release!, {
		packageName: `example`,
		packageDirectory: process.cwd(),
		currentVersion: `0.8.5`,
	}),
	versionTransition(`0.8.5`, `0.9.0`),
)
const cli = path.join(
	path.dirname(require.resolve(`breakage/package.json`)),
	`dist/breakage.x.js`,
)
assert.match(
	execFileSync(process.execPath, [cli, `help`], { encoding: `utf8` }),
	/USAGE/,
)
console.log(
	`Packed core and async TypeScript config work without the Changesets integration.`,
)
