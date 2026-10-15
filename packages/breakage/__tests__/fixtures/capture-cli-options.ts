import { mock } from "bun:test"

import type { BreakageOptions } from "../../src/breakage.ts"

await mock.module(`../../src/breakage.ts`, () => ({
	breakage: (options: BreakageOptions) => {
		process.stderr.write(JSON.stringify(options))
		return Promise.resolve({ breakingChangesFound: false })
	},
}))
