import tsdownConfig from "./tsdown.config.js"

import { defineConfig, type UserConfig } from "vite-plus"

const config: UserConfig = defineConfig({
	pack: tsdownConfig,
})

export default config
