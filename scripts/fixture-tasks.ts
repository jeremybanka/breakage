import { defineConfig, type UserConfig } from "vite-plus"

export const packageConfig: UserConfig = defineConfig({
	run: {
		tasks: {
			build: {
				command: "tsc --project tsconfig.build.json",
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
