import { readFile } from "node:fs/promises"
import type { NpmConfig } from "breakage"

const config: { npm: NpmConfig } = JSON.parse(
	await readFile(new URL(`./fixture-config.json`, import.meta.url), `utf8`),
)
export default config
