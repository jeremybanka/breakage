import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"

import { type } from "arktype"
import type { OptionsGroup } from "comline"
import { options, parseBooleanOption } from "comline"

import { formatNpmReport, npmCheck, npmTest } from "./check.ts"
import { errorMessage } from "./command.ts"
import { validateConfig } from "./config.ts"
import { record } from "./manifest.ts"
import type { NpmTestSelection } from "./types.ts"

type CommonOptions = { config?: string | undefined; json?: boolean | undefined }
type CheckOptions = CommonOptions & { coverageOnly?: boolean | undefined }
type TestOptions = CommonOptions & { representative?: string | undefined }

const common = {
	config: {
		required: false,
		description: `Configuration file (defaults to breakage.config.ts, then .json).`,
		example: `--config ./breakage.config.ts`,
		completion: { fileSystem: `files` as const, repeatable: false },
	},
	json: {
		required: false,
		description: `Emit the structured result.`,
		example: `--json`,
		parse: parseBooleanOption,
	},
}

export const npmCheckManual: OptionsGroup<CheckOptions> = options(
	`Check npm peer compatibility and changes in declared support.`,
	type({ "config?": `string`, "json?": `boolean`, "coverageOnly?": `boolean` }),
	{
		...common,
		coverageOnly: {
			aliases: [`coverage-only`],
			required: false,
			description: `Audit coverage and support changes without executing assertions.`,
			example: `--coverage-only`,
			parse: parseBooleanOption,
		},
	},
)

export const npmTestManual: OptionsGroup<TestOptions> = options(
	`Run current contracts in matching complete peer environments.`,
	type({
		"config?": `string`,
		"json?": `boolean`,
		"representative?": `string`,
	}),
	{
		...common,
		representative: {
			required: false,
			description: `Select an exact configured representative path relative to the package.`,
			example: `--representative peer-environments/react-19`,
			completion: { fileSystem: `directories`, repeatable: false },
		},
	},
)

export function defaultConfig(directory: string): string {
	return path.join(
		directory,
		existsSync(path.join(directory, `breakage.config.ts`))
			? `breakage.config.ts`
			: `breakage.config.json`,
	)
}

export async function runNpmCli(
	action: `check` | `test`,
	opts: CheckOptions & TestOptions,
	peerSelection?: { peer: string; range: string },
): Promise<number> {
	try {
		const filename = path.resolve(opts.config ?? defaultConfig(process.cwd()))
		const loaded: unknown = filename.endsWith(`.json`)
			? JSON.parse(await readFile(filename, `utf8`))
			: ((await import(pathToFileURL(filename).href)) as { default: unknown })
					.default
		const config = record(loaded) ? loaded.npm : undefined
		validateConfig(config)
		let selection: NpmTestSelection | undefined
		if (action === `test`) {
			if (peerSelection && opts.representative)
				throw new Error(`Choose a peer range or a representative, not both.`)
			selection =
				peerSelection ??
				(opts.representative
					? { representative: opts.representative }
					: undefined)
			if (!selection)
				throw new Error(
					`Use npm test <peer> <range> or npm test --representative <path>.`,
				)
		}
		const options = {
			baseDirectory: path.dirname(filename),
			coverageOnly: opts.coverageOnly ?? false,
		}
		const report = selection
			? await npmTest(config, selection, options)
			: await npmCheck(config, options)
		process.stdout.write(
			opts.json
				? `${JSON.stringify(report, null, 2)}\n`
				: formatNpmReport(report),
		)
		return report.exitCode
	} catch (error) {
		const message = errorMessage(error)
		process.stdout.write(
			opts.json
				? `${JSON.stringify({ exitCode: 2, errors: [message] })}\n`
				: `npm setup error: ${message}\n`,
		)
		return 2
	}
}
