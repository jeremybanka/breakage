import { existsSync } from "node:fs"
import path from "node:path"

import { type } from "arktype"
import { cli, options, type ConfigInput } from "comline"

import { npmConfigSchema } from "./npm/config.ts"
import {
	releaseSchema,
	validateRelease,
	rejectCertificationOptions,
} from "./release.ts"

// Reuse these field schemas for CLI metadata even though hooks cannot become JSON Schema.
export const configFields = {
	tagPattern: type(`string`),
	baselineFile: type(`string`),
	testPattern: type(`string`),
	testCommand: type(`string`),
	test: type(`string`),
	baseDirname: type(`string`),
	verbose: type(`boolean`),
	out: type(`string`),
}
export const configSchema = type({
	"+": `reject`,
	"tagPattern?": configFields.tagPattern.or(`undefined`),
	"baselineFile?": configFields.baselineFile.or(`undefined`),
	"testPattern?": configFields.testPattern,
	"testCommand?": configFields.testCommand,
	"test?": configFields.test,
	"baseDirname?": configFields.baseDirname,
	"verbose?": configFields.verbose.or(`undefined`),
	"out?": configFields.out,
	"release?": releaseSchema,
	"npm?": npmConfigSchema,
})

/** The complete config, with no fields exposed to argv by this loader. */
export const configOptions = options(`Breakage configuration`, configSchema, {
	tagPattern: { configOnly: true },
	baselineFile: { configOnly: true },
	testPattern: { configOnly: true },
	testCommand: { configOnly: true },
	test: { configOnly: true },
	baseDirname: { configOnly: true },
	verbose: { configOnly: true },
	out: { configOnly: true },
	release: { configOnly: true },
	npm: { configOnly: true },
})
export type BreakageConfig = ConfigInput<typeof configOptions>

/** Share the root release model with npm checks unless they supply their own. */
export function defineConfig(config: BreakageConfig): BreakageConfig {
	if (config && typeof config === `object`) {
		rejectCertificationOptions(config)
		if (config.npm) rejectCertificationOptions(config.npm)
		if (config.release !== undefined) validateRelease(config.release)
		if (config.npm?.release !== undefined) validateRelease(config.npm.release)
	}
	configSchema.assert(config)
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

/** Comline ignores absent discovered files; explicit paths must exist. */
export function configPath(filename: string, required = true): string {
	const absolute = path.resolve(filename)
	if (path.extname(absolute) !== `.ts`)
		throw new Error(
			`Configuration must be a .ts module with a default export; JSON configuration was removed.`,
		)
	if (required && !existsSync(absolute))
		throw new Error(`Configuration file does not exist: ${absolute}`)
	return absolute
}

/** Apply application semantics after Comline validates and merges configuration. */
export function resolveConfig(
	config: BreakageConfig,
	filename?: string,
): BreakageConfig {
	return {
		...defineConfig(config),
		baseDirname: path.resolve(
			filename ? path.dirname(filename) : process.cwd(),
			config.baseDirname ?? `.`,
		),
	}
}

/** Use Comline's module loading and full-schema validation for programmatic and npm consumers. */
export async function loadConfig(filename: string): Promise<BreakageConfig> {
	const absolute = configPath(filename)
	const parse = cli({
		cliName: `breakage`,
		routeOptions: { "": configOptions },
		discoverConfigPath: () => absolute,
	})
	return resolveConfig(
		(await parse.async([process.execPath, `breakage`])).inputs.opts,
		absolute,
	)
}
