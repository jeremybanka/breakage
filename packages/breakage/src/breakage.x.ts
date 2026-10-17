#!/usr/bin/env node

import * as path from "node:path"
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
} from "comline"
import logger from "takua"

import type { BreakageOptions, PeerBreakageOptions } from "./breakage.ts"
import { breakage, breakagePrelude } from "./breakage.ts"

const embassySchema = type({
	"[string]": {
		testPattern: `string`,
		testCommand: `string`,
		"peers?": `string[]`,
		"+": `reject`,
	},
})
const peerOptionsSchema = type({
	"setupCommand?": `string`,
	"manifest?": `string`,
	"installer?": `"pnpm"`,
	"prepareCommand?": `string`,
	"verifyCommand?": `string`,
	"testDependencies?": { "[string]": `string` },
	"sources?": { "[string]": `string` },
	"maxEnvironments?": `number`,
	"workspace?": {
		"[string]": {
			directory: `string`,
			"tagPattern?": `string`,
			"setupCommand?": `string`,
			"+": `reject`,
		},
	},
	"+": `reject`,
})

const BREAKAGE_MANUAL = options(
	`Check for breaking changes in a package.`,
	type({
		"tagPattern?": `string`,
		"baselineFile?": `string`,
		"embassies?": embassySchema,
		"peerOptions?": peerOptionsSchema,
		"testPattern?": `string`,
		"testCommand?": `string`,
		"certifyCommand?": `string`,
		"baseDirname?": `string`,
		"verbose?": `boolean`,
	}),
	{
		embassies: {
			required: false,
			parse: (value: string) => embassySchema.assert(JSON.parse(value)),
			description: `Current test suites for relationships with declared peers; configure these in breakage.config.json.`,
			example: `"embassies": { "react": { "testPattern": "tests/react/**", "testCommand": "bun test tests/react" } }`,
		},
		peerOptions: {
			required: false,
			parse: (value: string) => peerOptionsSchema.assert(JSON.parse(value)),
			description: `Shared embassy preparation settings in breakage.config.json. Environments are inferred from package.json.`,
			example: `"peerOptions": { "maxEnvironments": 64 }`,
		},
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
		certifyCommand: {
			aliases: [`certify-command`],
			completion: { repeatable: false },
			flag: `c`,
			required: false,
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
) satisfies OptionsGroup<
	Partial<BreakageOptions> & Partial<PeerBreakageOptions>
>

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
		"embassies?": embassySchema,
		"peerOptions?": peerOptionsSchema,
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
			prelude: optional({ $configPath: null }),
			$configPath: null,
		}),
		routeOptions: {
			"": BREAKAGE_MANUAL,
			$configPath: BREAKAGE_MANUAL,
			help: noOptions(`Show usage.`),
			schema: SCHEMA_MANUAL,
			prelude: PRELUDE_MANUAL,
			"prelude/$configPath": PRELUDE_MANUAL,
		},
		positionalCompletions: {
			$configPath: { fileSystem: `files` },
			"prelude/$configPath": { fileSystem: `files` },
		},
		discoverConfigPath: (args: readonly string[]) => {
			if (args[0] === `help` || args[0] === `schema`) {
				return
			}
			const configPath =
				(args[0] === `prelude` ? args[1] : args[0]) ??
				path.join(process.cwd(), `breakage.config.json`)
			return configPath
		},
	},
	{
		info: (message, ...data) => logger.info(`breakage`, message, data),
		error: (message, ...data) => logger.error(`breakage`, message, data),
	},
)

function failSetup(error: unknown): never {
	const messages: string[] = []
	const seen = new Set<unknown>()
	while (error !== undefined && !seen.has(error)) {
		seen.add(error)
		messages.push(error instanceof Error ? error.message : inspect(error))
		error = error instanceof Error ? error.cause : undefined
	}
	process.stderr.write(`${messages.join(`\n`)}\n`)
	process.exit(2)
}

const completion = await completionResponse(parse.definition, process.argv)
if (completion !== undefined) {
	process.stdout.write(completion)
} else {
	const { inputs, warnings, writeJsonSchema } = parse(process.argv)
	logWarnings(warnings)

	switch (inputs.case) {
		case `help`:
			console.log(help(parse.definition))
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
			}).catch(failSetup)
			process.stdout.write(`Pinned ${baseline.ref} at ${baseline.commit}.\n`)
			break
		}
		case ``:
		case `$configPath`: {
			const { returnValue } = await encapsulate(
				() => {
					if (inputs.opts.embassies !== undefined)
						return breakage({
							...inputs.opts,
							embassies: inputs.opts.embassies,
						})
					const { testPattern, testCommand, certifyCommand } = inputs.opts
					if (!testPattern || !testCommand || !certifyCommand)
						throw new Error(
							`Public compatibility check required arguments were not provided: testPattern, testCommand, and certifyCommand.`,
						)
					return breakage({
						...inputs.opts,
						testPattern,
						testCommand,
						certifyCommand,
					})
				},
				{
					console: true,
					stdout: true,
				},
			).catch(failSetup)
			if (`peerCheck` in returnValue) {
				process.stdout.write(`${JSON.stringify(returnValue, null, 2)}\n`)
				process.exit(
					returnValue.success
						? 0
						: (`publicResult` in returnValue &&
									returnValue.publicResult &&
									!(`breakingChangesFound` in returnValue.publicResult)) ||
							  returnValue.peerResults.some(
									(result) => result.status === `setup-failed`,
							  )
							? 2
							: 1,
				)
			}
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
