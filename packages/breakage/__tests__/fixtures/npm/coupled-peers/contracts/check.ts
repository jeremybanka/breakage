import { strict as assert } from "node:assert"
import host from "coupled-host"
import { host as used } from "coupled-integration"

assert.equal(host, used)
assert.equal(host.value, `works`)
