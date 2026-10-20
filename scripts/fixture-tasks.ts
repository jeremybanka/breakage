import { defineConfig, type UserConfig } from "vite-plus"

export const packageConfig: UserConfig = defineConfig({
	pack: {
		entry: ["src/index.ts"],
		// Emit entrypoint declarations; vp check handles project-wide typechecking.
		dts: { generator: "oxc" },
		fixedExtension: false,
	},
	run: {
		tasks: {
			build: {
				command: "vp pack",
				dependsOn: [
					{
						task: "build",
						from: ["dependencies", "devDependencies", "peerDependencies"],
					},
				],
			},
		},
	},
})
