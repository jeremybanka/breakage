import { strict as assert } from "node:assert"
import { createRequire } from "node:module"
import path from "node:path"
import {
	changesetsReleaseDelta,
	readChangesetsReleasePlan,
} from "@breakage/changesets"

const require = createRequire(import.meta.url)
assert.throws(() => require.resolve(`@changesets/cli`), {
	code: `MODULE_NOT_FOUND`,
})
const directory = path.resolve(`fixtures/workspace`)
const plan = await readChangesetsReleasePlan(directory)
assert.equal(plan.get(`peer-core`), `0.54.0`)
assert.equal(plan.get(`peer-integration`), `1.0.1`)
assert.deepEqual(
	await changesetsReleaseDelta({ directory })({
		packageName: `peer-core`,
		packageDirectory: directory,
		currentVersion: `0.53.3`,
	}),
	{ previousVersion: `0.53.3`, version: `0.54.0`, delta: `minor` },
)
console.log(
	`Packed integration resolves release intent without installing the Changesets CLI or listing internal dependencies.`,
)
