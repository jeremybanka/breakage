import { mock } from "bun:test"

import type { BreakageOptions } from "../../src/breakage.ts"

await mock.module(`../../src/breakage.ts`, () => ({
	breakagePrelude: () => {
		throw new Error(`The prelude must not run on the check route.`)
	},
	breakage: (options: BreakageOptions) => {
		process.stderr.write(JSON.stringify(options))
		return Promise.resolve({ breakingChangesFound: false })
	},
}))
