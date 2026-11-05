import { defineConfig } from "vite-plus"

export default defineConfig({
	run: {
		tasks: {
			"test:breakage:npm": {
				command: "node ../../scripts/check-changesets.node.ts",
				dependsOn: ["build"],
				cache: false,
			},
			"build:run": { command: "vp pack", dependsOn: ["breakage#build"] },
		},
	},
	pack: {
		deps: {
			// tsdown <0.23 compatibility: resolve external dependency subpaths.
			// Remove to preserve subpath imports as written (the new default).
			// https://tsdown.dev/options/dependencies#deps-resolvedepsubpath
			resolveDepSubpath: true,
		},
		entry: ["src/changesets.ts"],
		dts: { sourcemap: true },
		fixedExtension: false,
		sourcemap: true,
		tsconfig: "tsconfig.build.json",
	},
})
