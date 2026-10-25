import { versionTransition, defineConfig, semverPolicy } from "breakage"
import { settings } from "./settings.ts"

export default defineConfig({
	...settings,
	release: {
		resolveDelta: ({ baseline, currentVersion }) => {
			return versionTransition(baseline?.version ?? currentVersion, `0.9.0`)
		},
		policy: semverPolicy({ beforeV1: `minor` }),
	},
})
