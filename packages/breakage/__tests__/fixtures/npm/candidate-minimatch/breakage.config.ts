import type { NpmConfig } from "breakage"

const config: { npm: NpmConfig } = {
	npm: {
		releaseIntent: ({ packageName }) =>
			packageName === `host`
				? { status: `release`, version: `2.0.0` }
				: { status: `none` },
		artifact: "artifacts/integration-1.1.0.tgz",
		representatives: "peer-environments/minimatch-8",
		lockfile: "package-lock.json",
		prepareCommand:
			"npm ci --ignore-scripts --offline --cache ../../.cache --no-audit --no-fund",
		installCommand:
			"npm install --ignore-scripts --legacy-peer-deps --package-lock=false --offline --cache ../../../.cache --no-audit --no-fund",
		suites: {
			host: {
				files: ["contracts/*.ts"],
				command: "node contracts/check.ts",
			},
			minimatch: {
				files: ["contracts/*.ts"],
				command: "node contracts/check.ts",
			},
		},
		localPeers: {
			host: {
				directory: "local-host",
				artifact: "artifacts/host-2.0.0.tgz",
			},
		},
		baseline: {
			firstRelease: true,
		},
	},
}
export default config
