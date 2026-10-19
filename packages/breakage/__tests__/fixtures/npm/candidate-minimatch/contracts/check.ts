import { strict as assert } from "node:assert"
import { minimatch } from "minimatch"
import { matcher as hostMatcher } from "host"
import { matcher, matches } from "integration"

assert.equal(hostMatcher, minimatch)
assert.equal(matcher, minimatch)
assert.equal(matches(`src/file.ts`), true)
assert.equal(matches(`src/file.md`), false)
console.log(`Shared minimatch identity and file matching assertions passed.`)
