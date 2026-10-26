import type { NpmConfig } from "breakage"

const config: { npm: NpmConfig } = {
	npm: {
		artifact: "artifacts/coupled-integration-1.1.0.tgz",
		representatives: "peer-environments/*",
		lockfile: "package-lock.json",
		prepareCommand:
			"npm ci --ignore-scripts --offline --cache ../../.cache --no-audit --no-fund",
		installCommand:
			"npm install --ignore-scripts --legacy-peer-deps --package-lock=false --offline --cache ../../../.cache --no-audit --no-fund",
		suites: {
			"coupled-host": {
				files: ["contracts/*.ts"],
				command: "node contracts/check.ts",
			},
			"coupled-renderer": {
				files: ["contracts/renderer.ts"],
				command: "node contracts/renderer.ts",
			},
		},
		localPeers: {
			"coupled-host": {
				directory: "local-host",
				artifact: "artifacts/coupled-host-2.0.0.tgz",
			},
		},
		baseline: {},
	},
}
export default config
