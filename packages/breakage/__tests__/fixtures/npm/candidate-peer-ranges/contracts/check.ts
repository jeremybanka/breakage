import { strict as assert } from "node:assert"
import { renderer } from "renderer"
import { renderer as hostRenderer } from "host"
import { renderer as integrationRenderer, render } from "integration"

assert.equal(hostRenderer, renderer)
assert.equal(integrationRenderer, renderer)
assert.equal(render(`hello`), `<p>hello</p>`)
console.log(`Shared renderer identity and rendering assertions passed.`)
