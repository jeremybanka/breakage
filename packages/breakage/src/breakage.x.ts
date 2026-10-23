#!/usr/bin/env node

import { existsSync } from "node:fs"
import path from "node:path"
import { inspect } from "node:util"

import { type } from "arktype"
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

import { defaultConfig, loadConfig } from "./config.ts"
import { breakage, breakagePrelude } from "./breakage.ts"
import { errorMessage } from "./task.ts"
import { npmCheckManual, npmTestManual, runNpmCli } from "./npm/cli.ts"

const releaseSchema = type({
	"version?": "string",
	"policy?": { "beforeV1?": '"major" | "minor" | "patch"' },
})

const BREAKAGE_MANUAL = options(
	`Check for breaking changes in a package.`,
	type({
		"tagPattern?": `string`,
		"baselineFile?": `string`,
		"testPattern?": `string`,
		"testCommand?": `string`,
		"test?": `string`,
		"release?": releaseSchema,
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
			required: false,
			description: `The pattern to match test files that test the public API of the library.`,
			example: `--pattern="*__public.test.ts"`,
		},
		testCommand: {
			aliases: [`test-command`],
			completion: { repeatable: false },
			flag: `t`,
			required: false,
			description: `Complete bash command that runs the tests for the library's public API.`,
			example: `--testCommand="npm run test"`,
		},
		test: {
			completion: { repeatable: false },
			required: false,
			description: `Shell command running the restored public contracts.`,
			example: `--test="npm run test:public"`,
		},
		release: {
			completion: { repeatable: false },
			required: false,
			description: `Release version and policy as JSON; omitted version uses the package manifest.`,
			example: `--release='{"policy":{"beforeV1":"minor"}}'`,
			parse: (input) => releaseSchema.assert(JSON.parse(input)),
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
)

const PRELUDE_MANUAL = options(
	`Resolve and fetch the release baseline for a cacheable compatibility check.`,
	type({
		"tagPattern?": `string`,
		"baseDirname?": `string`,
		"out?": `string`,
		"testPattern?": `string`,
		"testCommand?": `string`,
		"test?": `string`,
		"release?": releaseSchema,
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
		const { inputs, warnings, writeJsonSchema } = parse(process.argv)
		logWarnings(warnings)
		if (
			process.argv
				.slice(2)
				.some((arg) =>
					/^(?:--certifyCommand|--certify-command|-c)(?:=|$)/.test(arg),
				)
		)
			throw new Error(
				`certifyCommand was removed. Configure release.version and release.policy instead.`,
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
				const configPath =
					inputs.case === `prelude/$configPath`
						? inputs.params.configPath
						: defaultConfig(process.cwd())
				const config: Awaited<ReturnType<typeof loadConfig>> =
					existsSync(configPath) || inputs.case === `prelude/$configPath`
						? await loadConfig(configPath)
						: {}
				const baseline = await breakagePrelude({
					...config,
					...inputs.opts,
					...(inputs.opts.baseDirname
						? { baseDirname: path.resolve(inputs.opts.baseDirname) }
						: {}),
					out: inputs.opts.out ?? config.out ?? `.breakage/baseline.json`,
				})
				process.stdout.write(`Pinned ${baseline.ref} at ${baseline.commit}.\n`)
				break
			}
			case ``:
			case `$configPath`: {
				const configPath =
					inputs.case === `$configPath`
						? inputs.params.configPath
						: defaultConfig(process.cwd())
				const config: Awaited<ReturnType<typeof loadConfig>> =
					existsSync(configPath) || inputs.case === `$configPath`
						? await loadConfig(configPath)
						: {}
				const merged = {
					...config,
					...inputs.opts,
					...(inputs.opts.baseDirname
						? { baseDirname: path.resolve(inputs.opts.baseDirname) }
						: {}),
				}
				if (inputs.opts.testCommand) delete merged.test
				if (inputs.opts.test) delete merged.testCommand
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
