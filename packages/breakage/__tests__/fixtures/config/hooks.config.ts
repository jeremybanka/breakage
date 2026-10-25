import type { ReleaseDeltaResolver, ReleasePolicy } from "breakage"
import config from "./breakage.config.ts"

export const resolveDelta: ReleaseDeltaResolver = async () => {
	throw new Error(`Loading config must not resolve a release.`)
}
export const policy: ReleasePolicy = () => {
	throw new Error(`Loading config must not evaluate policy.`)
}

export default { ...config, release: { resolveDelta, policy } }
