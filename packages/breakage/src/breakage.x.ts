#!/usr/bin/env node

import path from "node:path"
import { inspect } from "node:util"

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

import {
	defaultConfig,
	configPath,
	resolveConfig,
	configSchema,
	configFields,
} from "./config.ts"
import { breakage, breakagePrelude } from "./breakage.ts"
import { errorMessage } from "./task.ts"
import { npmCheckManual, npmTestManual, runNpmCli } from "./npm/cli.ts"
import {
	npmPlanManual,
	npmExecuteManual,
	npmVerifyManual,
	runNpmMatrixCli,
} from "./npm/matrix-cli.ts"

// Either command spelling can override the other spelling in a config file.
const commandOverrides = new Set<`test` | `testCommand`>()

const BREAKAGE_MANUAL = options(
	`Check for breaking changes in a package.`,
	configSchema,
	{
		release: { configOnly: true },
		npm: { configOnly: true },
		npmMatrix: { configOnly: true },
		out: { configOnly: true },
		tagPattern: {
			schema: configFields.tagPattern,
			aliases: [`tag-pattern`],
			completion: { repeatable: false },
			flag: `g`,
			required: false,
			description: `RegExp which, if found matched to a git tag, will be considered a release tag for your library.`,
			example: `--tagPattern="my-library"`,
		},
		baselineFile: {
			schema: configFields.baselineFile,
			aliases: [`baseline-file`],
			completion: { repeatable: false, fileSystem: `files` },
			required: false,
			description: `Use the exact locally fetched commit from a prelude snapshot instead of discovering remote tags.`,
			example: `--baseline-file=.breakage/baseline.json`,
		},
		testPattern: {
			schema: configFields.testPattern,
			aliases: [`test-pattern`, `pattern`],
			completion: { repeatable: false },
			flag: `p`,
			required: false,
			description: `The pattern to match test files that test the public API of the library.`,
			example: `--pattern="*__public.test.ts"`,
		},
		testCommand: {
			parse: (value) => {
				commandOverrides.add(`testCommand`)
				return value
			},
			schema: configFields.testCommand,
			aliases: [`test-command`],
			completion: { repeatable: false },
			flag: `t`,
			required: false,
			description: `Complete bash command that runs the tests for the library's public API.`,
			example: `--testCommand="npm run test"`,
		},
		test: {
			parse: (value) => {
				commandOverrides.add(`test`)
				return value
			},
			schema: configFields.test,
			completion: { repeatable: false },
			required: false,
			description: `Shell command running the restored public contracts.`,
			example: `--test="npm run test:public"`,
		},
		baseDirname: {
			parse: (value) => path.resolve(value),
			schema: configFields.baseDirname,
			aliases: [`base-dir`, `base-dirname`],
			completion: { repeatable: false, fileSystem: `directories` },
			flag: `d`,
			required: false,
			description: `The base directory to run the command from.`,
			example: `--baseDirname=./packages/my-package`,
		},
		verbose: {
			schema: configFields.verbose,
			completion: { repeatable: false },
			flag: `v`,
			required: false,
			description: `Prints out more information about the process.`,
			example: `--verbose`,
			parse: parseBooleanOption,
		},
	},
)

const PRELUDE_MANUAL = options(
	`Resolve and fetch the release baseline for a cacheable compatibility check.`,
	configSchema,
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
		out: {
			schema: configFields.out,
			completion: { repeatable: false, fileSystem: `files` },
			required: false,
			description: `Gitignored snapshot path relative to the base directory (default: .breakage/baseline.json).`,
			example: `--out=.breakage/baseline.json`,
		},
	},
)

let loadedConfigPath: string | undefined
const parse = cli(
	{
		cliName: `breakage`,
		discoverConfigPath: (segments: readonly string[]) => {
			if (segments[0] === `help` || segments[0] === `npm`) return undefined
			const explicit = segments[0] === `prelude` ? segments[1] : segments[0]
			loadedConfigPath = configPath(
				explicit ?? defaultConfig(process.cwd()),
				explicit !== undefined,
			)
			return loadedConfigPath
		},
		routes: optional({
			help: null,
			npm: optional({
				help: null,
				check: null,
				plan: null,
				execute: required({ $id: null }),
				verify: null,
				test: optional({ $peer: required({ $range: null }) }),
			}),
			prelude: optional({ $configPath: null }),
			$configPath: null,
		}),
		routeOptions: {
			"": BREAKAGE_MANUAL,
			$configPath: BREAKAGE_MANUAL,
			help: noOptions(`Show usage.`),
			npm: noOptions(`Show npm compatibility commands.`),
			"npm/help": noOptions(`Show npm compatibility commands.`),
			"npm/check": npmCheckManual,
			"npm/plan": npmPlanManual,
			"npm/execute/$id": npmExecuteManual,
			"npm/verify": npmVerifyManual,
			"npm/test": npmTestManual,
			"npm/test/$peer/$range": npmTestManual,
			prelude: PRELUDE_MANUAL,
			"prelude/$configPath": PRELUDE_MANUAL,
		},
		positionalCompletions: {
			$configPath: { fileSystem: `files` },
			"prelude/$configPath": { fileSystem: `files` },
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
	try {
		const { inputs, warnings } = await parse.async(process.argv)
		logWarnings(warnings)
		if (
			process.argv
				.slice(2)
				.some((arg) =>
					/^(?:--certifyCommand|--certify-command|-c)(?:=|$)/.test(arg),
				)
		)
			throw new Error(
				`certifyCommand was removed. Configure release.resolveDelta and release.policy instead.`,
			)

		switch (inputs.case) {
			case `npm`:
			case `npm/help`:
			case `help`:
				console.log(help(parse.definition))
				break
			case `npm/check`:
				process.exitCode = await runNpmCli(`check`, inputs.opts)
				break
			case `npm/plan`:
				process.exitCode = await runNpmMatrixCli(`plan`, inputs.opts)
				break
			case `npm/execute/$id`:
				process.exitCode = await runNpmMatrixCli(
					`execute`,
					inputs.opts,
					inputs.params.id,
				)
				break
			case `npm/verify`:
				process.exitCode = await runNpmMatrixCli(`verify`, inputs.opts)
				break
			case `npm/test`:
				process.exitCode = await runNpmCli(`test`, inputs.opts)
				break
			case `npm/test/$peer/$range`:
				process.exitCode = await runNpmCli(`test`, inputs.opts, inputs.params)
				break
			case `prelude`:
			case `prelude/$configPath`: {
				const config = resolveConfig(inputs.opts, loadedConfigPath)
				const baseline = await breakagePrelude({
					...config,
					out: config.out ?? `.breakage/baseline.json`,
				})
				process.stdout.write(`Pinned ${baseline.ref} at ${baseline.commit}.\n`)
				break
			}
			case ``:
			case `$configPath`: {
				const merged = resolveConfig(inputs.opts, loadedConfigPath)
				if (
					commandOverrides.has(`testCommand`) &&
					!commandOverrides.has(`test`)
				)
					delete merged.test
				if (
					commandOverrides.has(`test`) &&
					!commandOverrides.has(`testCommand`)
				)
					delete merged.testCommand
				if (!merged.testPattern)
					throw new Error(`required arguments were not provided: testPattern.`)
				const { returnValue } = await encapsulate(
					() =>
						breakage({
							...merged,
							testPattern: merged.testPattern!,
						}),
					{
						console: true,
						stdout: true,
					},
				)
				if (`release` in returnValue && returnValue.release) {
					const { previousVersion, version, delta, breaking } =
						returnValue.release
					process.stdout.write(
						`Release: ${previousVersion} → ${version} (${delta}; ${breaking ? `breaking` : `compatible`}).\n`,
					)
				}
				if (`testResult` in returnValue && returnValue.breakingChangesFound) {
					process.stdout.write(returnValue.testResult)
				}
				if (`breakingChangesFound` in returnValue) {
					if (returnValue.breakingChangesFound) {
						if (returnValue.release?.breaking) {
							process.stdout.write(
								`👷 Breaking changes are covered by the breaking release.`,
							)
							process.exit(0)
						} else {
							process.stdout.write(
								`❌ Breaking changes require a breaking release.`,
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
	} catch (error) {
		process.stderr.write(`Breakage setup error: ${errorMessage(error)}\n`)
		process.exitCode = 2
	}
}
