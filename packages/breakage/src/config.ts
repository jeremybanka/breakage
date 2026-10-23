import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
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
	return path.join(
		directory,
		existsSync(path.join(directory, `breakage.config.ts`))
			? `breakage.config.ts`
			: `breakage.config.json`,
	)
}

/** Relative directories are resolved from the config file, never the caller's cwd. */
export async function loadConfig(filename: string): Promise<BreakageConfig> {
	const absolute = path.resolve(filename)
	const loaded = /\.(?:[cm]?[jt]s)$/.test(absolute)
		? (
				(await import(pathToFileURL(absolute).href)) as {
					default: BreakageConfig
				}
			).default
		: (JSON.parse(await readFile(absolute, `utf8`)) as BreakageConfig)
	const config = defineConfig(loaded)
	return {
		...config,
		baseDirname: path.resolve(
			path.dirname(absolute),
			config.baseDirname ?? `.`,
		),
	}
}
