#!/usr/bin/env node

import { inspect } from "node:util"

import { type } from "arktype"
import type { OptionsGroup } from "comline"
import {
	cli,
	completionResponse,
	encapsulate,
	help,
	logWarnings,
	noOptions,
	optional,
	options,
	parseBooleanOption,
	required,
} from "comline"
import logger from "takua"

import type { BreakageOptions } from "./breakage.ts"
import { breakage, breakagePrelude } from "./breakage.ts"
import {
	defaultConfig,
	npmCheckManual,
	npmTestManual,
	runNpmCli,
} from "./npm/cli.ts"

const BREAKAGE_MANUAL = options(
	`Check for breaking changes in a package.`,
	type({
		"tagPattern?": `string`,
		"baselineFile?": `string`,
		testPattern: `string`,
		testCommand: `string`,
		certifyCommand: `string`,
		"baseDirname?": `string`,
		"verbose?": `boolean`,
	}),
	{
		tagPattern: {
			aliases: [`tag-pattern`],
			completion: { repeatable: false },
			flag: `g`,
			required: false,
			description: `RegExp which, if found matched to a git tag, will be considered a release tag for your library.`,
			example: `--tagPattern="my-library"`,
		},
		baselineFile: {
			aliases: [`baseline-file`],
			completion: { repeatable: false, fileSystem: `files` },
			required: false,
			description: `Use the exact locally fetched commit from a prelude snapshot instead of discovering remote tags.`,
			example: `--baseline-file=.breakage/baseline.json`,
		},
		testPattern: {
			aliases: [`test-pattern`, `pattern`],
			completion: { repeatable: false },
			flag: `p`,
			required: true,
			description: `The pattern to match test files that test the public API of the library.`,
			example: `--pattern="*__public.test.ts"`,
		},
		testCommand: {
			aliases: [`test-command`],
			completion: { repeatable: false },
			flag: `t`,
			required: true,
			description: `Complete bash command that runs the tests for the library's public API.`,
			example: `--testCommand="npm run test"`,
		},
		certifyCommand: {
			aliases: [`certify-command`],
			completion: { repeatable: false },
			flag: `c`,
			required: true,
			description: `Complete bash command that determines whether a major version bump for your package is indicated in the workspace. Exit code 0 indicates that a major version bump is indicated, and exit code 1 indicates that no major version bump is indicated.`,
			example: `--certifyCommand=\tsx scripts/certify-major-version-bump.node`,
		},
		baseDirname: {
			aliases: [`base-dir`, `base-dirname`],
			completion: { repeatable: false, fileSystem: `directories` },
			flag: `d`,
			required: false,
			description: `The base directory to run the command from.`,
			example: `--baseDirname=./packages/my-package`,
		},
		verbose: {
			completion: { repeatable: false },
			flag: `v`,
			required: false,
			description: `Prints out more information about the process.`,
			example: `--verbose`,
			parse: parseBooleanOption,
		},
	},
) satisfies OptionsGroup<BreakageOptions>

const PRELUDE_MANUAL = options(
	`Resolve and fetch the release baseline for a cacheable compatibility check.`,
	type({
		"tagPattern?": `string`,
		"baseDirname?": `string`,
		"out?": `string`,
		"testPattern?": `string`,
		"testCommand?": `string`,
		"certifyCommand?": `string`,
		"baselineFile?": `string`,
		"verbose?": `boolean`,
	}),
	{
		...BREAKAGE_MANUAL.optionConfigs,
		testPattern: {
			...BREAKAGE_MANUAL.optionConfigs.testPattern,
			required: false,
		},
		testCommand: {
			...BREAKAGE_MANUAL.optionConfigs.testCommand,
			required: false,
		},
		certifyCommand: {
			...BREAKAGE_MANUAL.optionConfigs.certifyCommand,
			required: false,
		},
		out: {
			completion: { repeatable: false, fileSystem: `files` },
			required: false,
			description: `Gitignored snapshot path relative to the base directory (default: .breakage/baseline.json).`,
			example: `--out=.breakage/baseline.json`,
		},
	},
)

const SCHEMA_MANUAL = options(
	`Create a copy of the schema for configuring breakage.`,
	type({ "outdir?": `string` }),
	{
		outdir: {
			aliases: [`out-dir`],
			completion: { repeatable: false, fileSystem: `directories` },
			flag: `o`,
			required: false,
			description: `Directory to write the schema to.`,
			example: `--outdir=./dist`,
		},
	},
)

const parse = cli(
	{
		cliName: `breakage`,
		routes: optional({
			help: null,
			schema: null,
			npm: optional({
				help: null,
				check: null,
				test: optional({ $peer: required({ $range: null }) }),
			}),
			prelude: optional({ $configPath: null }),
			$configPath: null,
		}),
		routeOptions: {
			"": BREAKAGE_MANUAL,
			$configPath: BREAKAGE_MANUAL,
			help: noOptions(`Show usage.`),
			schema: SCHEMA_MANUAL,
			npm: noOptions(`Show npm compatibility commands.`),
			"npm/help": noOptions(`Show npm compatibility commands.`),
			"npm/check": npmCheckManual,
			"npm/test": npmTestManual,
			"npm/test/$peer/$range": npmTestManual,
			prelude: PRELUDE_MANUAL,
			"prelude/$configPath": PRELUDE_MANUAL,
		},
		positionalCompletions: {
			$configPath: { fileSystem: `files` },
			"prelude/$configPath": { fileSystem: `files` },
		},
		discoverConfigPath: (args: readonly string[]) => {
			if (args[0] === `help` || args[0] === `schema` || args[0] === `npm`) {
				return
			}
			const configPath =
				(args[0] === `prelude` ? args[1] : args[0]) ??
				defaultConfig(process.cwd())
			return configPath
		},
	},
	{
		info: (message, ...data) => logger.info(`breakage`, message, data),
		error: (message, ...data) => logger.error(`breakage`, message, data),
	},
)

const completion = await completionResponse(parse.definition, process.argv)
if (completion !== undefined) {
	process.stdout.write(completion)
} else {
	const { inputs, warnings, writeJsonSchema } = parse(process.argv)
	logWarnings(warnings)

	switch (inputs.case) {
		case `npm`:
		case `npm/help`:
		case `help`:
			console.log(help(parse.definition))
			break
		case `npm/check`:
			process.exitCode = await runNpmCli(`check`, inputs.opts)
			break
		case `npm/test`:
			process.exitCode = await runNpmCli(`test`, inputs.opts)
			break
		case `npm/test/$peer/$range`:
			process.exitCode = await runNpmCli(`test`, inputs.opts, inputs.params)
			break
		case `schema`:
			{
				const { outdir } = inputs.opts
				writeJsonSchema(outdir ?? `.`)
				process.stdout.write(`📝 Wrote json.schema.`)
			}
			break
		case `prelude`:
		case `prelude/$configPath`: {
			const baseline = await breakagePrelude({
				...inputs.opts,
				out: inputs.opts.out ?? `.breakage/baseline.json`,
			})
			process.stdout.write(`Pinned ${baseline.ref} at ${baseline.commit}.\n`)
			break
		}
		case ``:
		case `$configPath`: {
			const { returnValue } = await encapsulate(() => breakage(inputs.opts), {
				console: true,
				stdout: true,
			})
			if (`testResult` in returnValue && returnValue.breakingChangesFound) {
				process.stdout.write(returnValue.testResult)
			}
			if (`breakingChangesFound` in returnValue) {
				if (returnValue.breakingChangesFound) {
					if (returnValue.breakingChangesCertified) {
						process.stdout.write(
							`👷 Breaking changes were found and certified.`,
						)
						process.exit(0)
					} else {
						process.stdout.write(
							`❌ Breaking changes were found, but not certified.`,
						)
						process.exit(1)
					}
				} else {
					process.stdout.write(`✅ No breaking changes were found.`)
					process.exit(0)
				}
			} else {
				process.stdout.write(
					`💥 Breakage failed to determine breaking changes.` +
						`\n` +
						inspect(returnValue),
				)
				process.exit(2)
			}
		}
	}
}
