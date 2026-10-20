import { defineConfig } from "vite-plus"

export default defineConfig({
	run: {
		tasks: {
			validate: {
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
