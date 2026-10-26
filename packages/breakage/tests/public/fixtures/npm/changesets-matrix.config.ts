import { readFile } from "node:fs/promises"
import { defineConfig, semverPolicy, type NpmConfig } from "breakage"
import { changesetsReleaseDelta } from "@breakage/changesets"

const config: { npm: NpmConfig } = JSON.parse(
	await readFile(new URL(`./fixture-config.json`, import.meta.url), `utf8`),
)
export default defineConfig({
	...config,
	release: {
		resolveDelta: changesetsReleaseDelta({ directory: import.meta.dirname }),
		policy: semverPolicy({ beforeV1: `minor` }),
	},
})
