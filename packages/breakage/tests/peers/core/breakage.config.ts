import { versionTransition, defineConfig, semverPolicy } from "breakage"

export default defineConfig({
	testPattern: `public/*.ts`,
	test: `node --test public/*.ts`,
	release: {
		resolveDelta: ({ baseline, currentVersion }) => {
			return versionTransition(baseline?.version ?? currentVersion, `0.9.0`)
		},
		policy: semverPolicy({ beforeV1: `minor` }),
	},
})
