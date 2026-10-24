import { strict as assert } from "node:assert"
import { value } from "../implementation.ts"
import { expected } from "./expected.ts"
assert.equal(value, expected, `released consumer behavior`)
