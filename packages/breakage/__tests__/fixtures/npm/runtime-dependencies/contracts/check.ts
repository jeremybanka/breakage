import { strict as assert } from "node:assert"
import host from "host"
import { host as used } from "integration"

assert.equal(host, used)
assert.equal(host.value, `works`)
