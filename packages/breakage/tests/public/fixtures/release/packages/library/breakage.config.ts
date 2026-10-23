import { defineConfig, semverPolicy } from "breakage"
import { changesetsRelease } from "breakage/changesets"

export default defineConfig({
	tagPattern: `refs/tags/release-library@`,
	testPattern: `public/*.ts`,
	test: ({ run }) => run(`node public/contract.ts`),
	release: {
		version: changesetsRelease(),
		policy: semverPolicy({ beforeV1: `minor` }),
	},
})
