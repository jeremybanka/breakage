import { defineConfig, type UserConfig } from "vite-plus"

const config: UserConfig = defineConfig({
	pack: {
		deps: {
			// tsdown <0.23 compatibility: resolve external dependency subpaths.
			// Remove to preserve subpath imports as written (the new default).
			// https://tsdown.dev/options/dependencies#deps-resolvedepsubpath
			resolveDepSubpath: true,
		},
		entry: [`src/breakage.ts`, `src/breakage.x.ts`],
		dts: { entry: [`src/breakage.ts`], sourcemap: true },
		fixedExtension: false,
		sourcemap: true,
		tsconfig: `tsconfig.build.json`,
	},
	run: {
		tasks: {
			"test:public:run": {
				command:
					"BREAKAGE_CLI_ENTRYPOINT=./dist/breakage.x.js bun test -- ./tests/public",
				dependsOn: ["build", "@breakage/changesets#build:run"],
				cache: false,
			},
			"test:run": {
				command:
					"BREAKAGE_CLI_ENTRYPOINT=./dist/breakage.x.js bun test ./__tests__ ./tests/public",
				dependsOn: [
					"build",
					"@breakage/changesets#build:run",
					"minimatch-integration#test:prepare",
				],
				cache: false,
			},
		},
	},
})

export default config
