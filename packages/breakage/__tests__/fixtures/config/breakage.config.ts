import { readFile } from "node:fs/promises"
import type { VersionTransition } from "breakage"

const data = JSON.parse(
	await readFile(new URL(`./config-data.json`, import.meta.url), `utf8`),
) as {
	options: Record<string, unknown>
	transition?: VersionTransition
	initializationError?: string
}
if (data.initializationError) throw new Error(data.initializationError)
export default {
	...data.options,
	...(data.transition
		? { release: { resolveDelta: () => data.transition } }
		: {}),
}
