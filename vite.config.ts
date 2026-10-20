import { defineConfig } from "vite-plus"

export default defineConfig({
	run: {
		tasks: {
			"check:vp:run": {
				command: "vp check --no-fmt",
				dependsOn: ["build"],
			},
		},
	},
	lint: {
		ignorePatterns: ["**/dist/**", "**/node_modules/**"],
		options: {
			typeAware: true,
			typeCheck: true,
		},
	},
	staged: {
		"*": ["dprint fmt --allow-no-files", "vp check --no-fmt --fix"],
	},
})
