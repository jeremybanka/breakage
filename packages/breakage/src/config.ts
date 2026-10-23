import { existsSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

import type { BreakageOptions } from "./breakage.ts"
import type { NpmConfig } from "./npm/types.ts"
import { validateRelease, rejectCertificationOptions } from "./release.ts"

export type BreakageConfig = Partial<BreakageOptions> & {
	npm?: NpmConfig
	out?: string
}

/** Share the root release model with npm checks unless they supply their own. */
export function defineConfig<Config extends BreakageConfig>(
	config: Config,
): Config & BreakageConfig {
	if (!config || typeof config !== `object` || Array.isArray(config))
		throw new Error(`Expected a Breakage configuration object.`)
	rejectCertificationOptions(config)
	if (config.npm) rejectCertificationOptions(config.npm)
	if (config.release !== undefined) validateRelease(config.release)
	if (config.npm?.release !== undefined) validateRelease(config.npm.release)
	return {
		...config,
		...(config.npm
			? {
					npm: {
						...config.npm,
						...(config.release && config.npm.release === undefined
							? { release: config.release }
							: {}),
					},
				}
			: {}),
	}
}

export function defaultConfig(directory: string): string {
	const filename = path.join(directory, `breakage.config.ts`)
	if (
		!existsSync(filename) &&
		existsSync(path.join(directory, `breakage.config.json`))
	)
		throw new Error(
			`JSON configuration was removed. Migrate breakage.config.json to breakage.config.ts.`,
		)
	return filename
}

/** Relative directories are resolved from the config file, never the caller's cwd. */
export async function loadConfig(filename: string): Promise<BreakageConfig> {
	const absolute = path.resolve(filename)
	if (path.extname(absolute) !== `.ts`)
		throw new Error(
			`Configuration must be a .ts module with a default export; JSON configuration was removed.`,
		)
	const loaded = (
		(await import(pathToFileURL(absolute).href)) as { default: BreakageConfig }
	).default
	const config = defineConfig(loaded)
	return {
		...config,
		baseDirname: path.resolve(
			path.dirname(absolute),
			config.baseDirname ?? `.`,
		),
	}
}
