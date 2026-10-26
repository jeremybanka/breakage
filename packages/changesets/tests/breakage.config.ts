import { defineConfig, semverPolicy } from "breakage"
import { changesetsReleaseDelta } from "@breakage/changesets"

export default defineConfig({
	release: {
		resolveDelta: changesetsReleaseDelta(),
		policy: semverPolicy({ beforeV1: "minor" }),
	},
})
