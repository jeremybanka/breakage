import { defineConfig } from "breakage"

import library from "./packages/library/breakage.config.ts"

export default defineConfig({
	...library,
	baseDirname: `packages/library`,
	out: `.breakage/custom.json`,
})
