import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import { value } from "../implementation.ts"
const current = JSON.parse(
	readFileSync(new URL(`../value.json`, import.meta.url), `utf8`),
) as { value: string }
assert.equal(value, current.value)
