import { readFileSync } from "node:fs"
import type { NpmConfig } from "breakage"

const npm: NpmConfig = JSON.parse(
	readFileSync(new URL(`./fixture-config.json`, import.meta.url), `utf8`),
)
const config: { npm: NpmConfig } = {
	npm: {
		...npm,
		releaseIntent: () => ({ status: `release`, version: `3.0.0` }),
	},
}
export default config
