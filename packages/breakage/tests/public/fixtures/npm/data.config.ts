import { readFileSync } from "node:fs"
import type { NpmConfig } from "breakage"

const config: { npm: NpmConfig } = JSON.parse(
	readFileSync(new URL(`./fixture-config.json`, import.meta.url), `utf8`),
)
export default config
