import { readFileSync } from "node:fs"
import type { VersionTransition } from "breakage"

const data = JSON.parse(
	readFileSync(new URL(`./config-data.json`, import.meta.url), `utf8`),
) as { options: Record<string, unknown>; transition?: VersionTransition }
export default {
	...data.options,
	...(data.transition
		? { release: { resolveDelta: () => data.transition } }
		: {}),
}
