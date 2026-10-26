import { strict as assert } from "node:assert"
import { version } from "coupled-renderer"

assert.ok([`19.0.0`, `20.0.0`].includes(version))
