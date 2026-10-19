import { readFileSync } from "node:fs"
import { strict as assert } from "node:assert"
import host from "host"
import { host as used } from "integration"

assert.equal(host, used)
assert.equal(host.value, `works`)

assert.equal(readFileSync(`fixtures/value.txt`, `utf8`), `copied fixture`)
assert.ok(process.cwd().includes(`/peer-environments/`))
assert.ok(process.cwd().endsWith(`/test`))
