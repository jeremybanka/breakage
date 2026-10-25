import assert from "node:assert/strict"
import { value } from "../src/value.ts"
assert.equal(value(), `released`)
