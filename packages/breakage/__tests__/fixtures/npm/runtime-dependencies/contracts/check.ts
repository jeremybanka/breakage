import { strict as assert } from "node:assert"
import host from "runtime-host"
import { host as used } from "runtime-integration"

assert.equal(host, used)
assert.equal(host.value, `works`)
