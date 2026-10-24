import { defineConfig, semverPolicy } from "./src/breakage.ts"
import { changesetsReleaseDelta } from "./src/changesets.ts"
import manifest from "./package.json" with { type: "json" }

export default defineConfig({
	release: {
		resolveDelta: changesetsReleaseDelta(),
		policy: semverPolicy({ beforeV1: `minor` }),
	},
	npm: {
		artifact: `artifacts/breakage.tgz`,
		representatives: `peer-environments/changesets-*`,
		lockfile: `package-lock.json`,
		prepareCommand: `npm ci --ignore-scripts --workspaces=false --no-audit --no-fund`,
		suites: Object.fromEntries(
			Object.keys(manifest.peerDependencies).map((peer) => [
				peer,
				{
					files: [
						`tests/peers/changesets.ts`,
						`tests/peers/fixtures/workspace/**/*`,
						`tests/peers/fixtures/workspace/.changeset/*`,
					],
					command: `node tests/peers/changesets.ts`,
				},
			]),
		),
		baseline: { tagPattern: `refs/tags/breakage@` },
	},
})
