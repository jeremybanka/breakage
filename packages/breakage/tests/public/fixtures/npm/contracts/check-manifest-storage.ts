import { readFileSync, statSync } from "node:fs"
import { strict as assert } from "node:assert"
import host from "host"
import { host as used } from "integration"

assert.equal(host, used)
assert.equal(host.value, `works`)

const expectedVersion = process.argv[2]
assert.ok(expectedVersion)
const installed = `node_modules/host/package.json`
const cached = `../../../.cache/host-manifest.json`
assert.equal(
	JSON.parse(readFileSync(installed, `utf8`)).version,
	expectedVersion,
)
assert.equal(
	statSync(installed).ino === statSync(cached).ino,
	expectedVersion === `2.0.0`,
)
