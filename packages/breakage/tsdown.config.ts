import type { InlineConfig, UserConfig } from "vite-plus/pack"
import { defineConfig } from "vite-plus/pack"

const config: UserConfig = defineConfig({
	deps: {
		// tsdown <0.23 compatibility: resolve external dependency subpaths.
		// Remove to preserve subpath imports as written (the new default).
		// https://tsdown.dev/options/dependencies#deps-resolvedepsubpath
		resolveDepSubpath: true,
	},
	entry: [`src/breakage.ts`, `src/breakage.x.ts`],

	clean: true,
	dts: { entry: [`src/breakage.ts`], sourcemap: true },
	fixedExtension: false,
	format: `esm`,
	outDir: `dist`,
	platform: `node`,
	sourcemap: true,
	treeshake: true,
	tsconfig: `tsconfig.json`,
} satisfies InlineConfig)

export default config
