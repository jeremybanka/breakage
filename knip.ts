import type { KnipConfig } from "knip"

// Public source entrypoints remain roots, including CLIs, workers, and conditional exports.
// Formatter plugins and JSON schemas are loaded by configuration paths, not imports.
// Generated distributions are checked through their authored source entrypoints.
export default {
	workspaces: {
		".": {
			entry: ["breakage.config.ts", "scripts/*.{ts,tsx}"],
			project: ["*.ts", "scripts/**/*.{ts,tsx}"],
			ignoreDependencies: [
				"@dprint/json",
				"@dprint/markdown",
				"@dprint/oxc",
				"@dprint/toml",
				"dprint-plugin-yaml",
				// The cache integration test launches the root node_modules/.bin/turbo.
				// The cache integration test launches the root node_modules/.bin/turbo.
				"turbo",
			],
		},
		"packages/breakage": {
			entry: [
				// The package publishes src and exposes ./ * subpaths (without the space).
				// The package publishes src and exposes ./ * subpaths (without the space).
				"src/**/*.ts!",
				"tests/peers/**/*.{ts,js}",
			],
			project: [
				"*.ts",
				"{src,bin}/**/*.{ts,tsx}!",
				"{tests,__tests__,peer-environments,examples}/**/*.{ts,tsx,js,mjs,cjs}",
				"!**/fixtures/**",
			],
		},
		"packages/changesets": {
			entry: [
				"src/changesets.ts!",
				"tests/**/fixtures/**/*.{ts,tsx,js,mjs,cjs}",
				"tests/{contract.ts,breakage.config.ts,consumer/smoke.ts}",
			],
			project: [
				"*.ts",
				"{src,bin}/**/*.{ts,tsx}!",
				"{tests,__tests__,peer-environments,examples}/**/*.{ts,tsx,js,mjs,cjs}",
			],
		},
	},
	// Deliberately broken fixture packages are input data for the parent test suite.
	ignoreWorkspaces: ["packages/breakage/**/fixtures/**"],
	// Vite Plus supplies vp to the published-source/config fixture graph.
	ignoreBinaries: ["vp"],
	ignore: ["**/dist/**"],
} satisfies KnipConfig
