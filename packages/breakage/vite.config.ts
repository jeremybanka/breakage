import tsdownConfig from "./tsdown.config.js"

import { defineConfig, type UserConfig } from "vite-plus"

const config: UserConfig = defineConfig({
	pack: tsdownConfig,
	run: {
		tasks: {
			suite: {
				command:
					"BREAKAGE_CLI_ENTRYPOINT=./src/breakage.x.ts bun test ./__tests__ ./tests/public",
				dependsOn: ["build", "minimatch-integration#test:prepare"],
				cache: false,
			},
		},
	},
})

export default config
