import type { NpmConfig } from "breakage"

const config: { npm: NpmConfig } = {
	npm: {
		artifact: "artifacts/runtime-integration-1.1.0.tgz",
		representatives: "environments/released-*",
		lockfile: "package-lock.json",
		prepareCommand:
			"npm ci --ignore-scripts --offline --cache ../../.cache --no-audit --no-fund",
		installCommand:
			"npm install --ignore-scripts --legacy-peer-deps --package-lock=false --offline --cache ../../../.cache --no-audit --no-fund",
		suites: {
			"runtime-host": {
				files: ["contracts/*.ts"],
				command: "node contracts/check.ts",
			},
		},
		localPeers: {
			"runtime-host": {
				directory: "local-host",
				artifact: "artifacts/runtime-host-2.0.0.tgz",
			},
		},
		baseline: {
			firstRelease: true,
		},
	},
}
export default config
