import { readFileSync } from "node:fs"

const data = JSON.parse(
	readFileSync(new URL(`./config-data.json`, import.meta.url), `utf8`),
) as { options: Record<string, unknown>; version?: string }
export default {
	...data.options,
	...(data.version ? { release: { version: () => data.version } } : {}),
}
