import { defineConfig, semverPolicy } from "breakage"
import { changesetsReleaseDelta } from "@breakage/changesets"

export default defineConfig({
	tagPattern: `refs/tags/release-library@`,
	testPattern: `public/*.ts`,
	test: `node public/contract.ts`,
	release: {
		resolveDelta: changesetsReleaseDelta(),
		policy: semverPolicy({ beforeV1: `minor` }),
	},
})
