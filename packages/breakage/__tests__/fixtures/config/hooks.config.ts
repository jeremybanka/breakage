import { readFileSync } from "node:fs"
import type { ReleaseDeltaResolver, ReleasePolicy } from "breakage"

const data = JSON.parse(
	readFileSync(new URL(`./config-data.json`, import.meta.url), `utf8`),
) as { options: Record<string, unknown> }

export const resolveDelta: ReleaseDeltaResolver = async () => {
	throw new Error(`Loading config must not resolve a release.`)
}
export const policy: ReleasePolicy = () => {
	throw new Error(`Loading config must not evaluate policy.`)
}

export default { ...data.options, release: { resolveDelta, policy } }
