import type { NpmConfig } from "breakage"

const config: { npm: NpmConfig } = {
	npm: {
		releaseIntent: ({ packageName }) =>
			packageName === `ranges-host`
				? { status: `release`, version: `2.0.0` }
				: { status: `none` },
		artifact: "artifacts/ranges-integration-1.1.0.tgz",
		representatives: "peer-environments/*",
		lockfile: "package-lock.json",
		prepareCommand:
			"npm ci --ignore-scripts --offline --cache ../../.cache --no-audit --no-fund",
		installCommand:
			"npm install --ignore-scripts --legacy-peer-deps --package-lock=false --offline --cache ../../../.cache --no-audit --no-fund",
		suites: {
			"ranges-host": {
				files: ["contracts/*.ts"],
				command: "node contracts/check.ts",
			},
			renderer: {
				files: ["contracts/*.ts"],
				command: "node contracts/check.ts",
			},
		},
		localPeers: {
			"ranges-host": {
				directory: "local-host",
				artifact: "artifacts/ranges-host-2.0.0.tgz",
			},
		},
		baseline: {
			firstRelease: true,
		},
	},
}
export default config
