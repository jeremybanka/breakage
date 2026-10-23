import { defineConfig, type UserConfig } from "vite-plus"

const config: UserConfig = defineConfig({
	pack: {
		deps: {
			// tsdown <0.23 compatibility: resolve external dependency subpaths.
			// Remove to preserve subpath imports as written (the new default).
			// https://tsdown.dev/options/dependencies#deps-resolvedepsubpath
			resolveDepSubpath: true,
		},
		entry: [`src/breakage.ts`, `src/breakage.x.ts`, `src/changesets.ts`],
		dts: { entry: [`src/breakage.ts`, `src/changesets.ts`], sourcemap: true },
		fixedExtension: false,
		sourcemap: true,
		tsconfig: `tsconfig.json`,
	},
	run: {
		tasks: {
			"test:breakage:npm": {
				command: "node ../../scripts/check-peers.node.ts",
				dependsOn: ["build"],
				cache: false,
			},
			"test:run": {
				command:
					"BREAKAGE_CLI_ENTRYPOINT=./src/breakage.x.ts bun test ./__tests__ ./tests/public",
				dependsOn: ["build", "minimatch-integration#test:prepare"],
				cache: false,
			},
		},
	},
})

export default config
