import { glob, readFile } from "node:fs/promises"
import path from "node:path"
import { type } from "arktype"
import { options } from "comline"
import { configOptions, defaultConfig, loadConfig } from "../config.ts"
import { errorMessage } from "../task.ts"
import { formatNpmReport } from "./check.ts"
import {
	npmPlan,
	npmExecute,
	npmVerify,
	npmMatrix,
	writeMatrixJson,
} from "./matrix.ts"

const hiddenSchema = {
	"release?": configOptions.optionsSchema.get(`release`),
	"npm?": configOptions.optionsSchema.get(`npm`),
	"npmMatrix?": configOptions.optionsSchema.get(`npmMatrix`),
}
const hidden = {
	release: { configOnly: true },
	npm: { configOnly: true },
	npmMatrix: { configOnly: true },
} as const
const root = {
	schema: type(`string`),
	required: false,
	description: `Source Git checkout root (defaults to the current directory).`,
	example: `--root .`,
	completion: { fileSystem: `directories` as const },
}
const plan = {
	schema: type(`string`),
	required: true,
	description: `Prepared plan.json; archives are read from its bundle directory.`,
	example: `--plan .breakage/npm-plan/plan.json`,
	completion: { fileSystem: `files` as const },
}

export const npmPlanManual = options(
	`Audit the peer matrix and prepare a portable archive bundle; print matrix JSON.`,
	type({
		...hiddenSchema,
		"config?": `string`,
		"root?": `string`,
		"out?": `string`,
	}),
	{
		...hidden,
		root,
		config: {
			schema: type(`string`),
			required: false,
			description: `TypeScript configuration containing npmMatrix.`,
			example: `--config breakage.config.ts`,
			completion: { fileSystem: `files` },
		},
		out: {
			schema: type(`string`),
			required: false,
			description: `Bundle directory (defaults to .breakage/npm-plan).`,
			example: `--out .breakage/peer-bundle`,
			completion: { fileSystem: `directories` },
		},
	},
)
export const npmExecuteManual = options(
	`Execute one planned representative and write its receipt.`,
	type({
		...hiddenSchema,
		plan: `string`,
		receipt: `string`,
		"root?": `string`,
	}),
	{
		...hidden,
		root,
		plan,
		receipt: {
			schema: type(`string`),
			required: true,
			description: `Output receipt filename.`,
			example: `--receipt .breakage/receipts/environment.json`,
			completion: { fileSystem: `files` },
		},
	},
)
export const npmVerifyManual = options(
	`Verify the complete planned matrix against collected execution receipts.`,
	type({
		...hiddenSchema,
		plan: `string`,
		receipts: `string`,
		"root?": `string`,
	}),
	{
		...hidden,
		root,
		plan,
		receipts: {
			schema: type(`string`),
			required: true,
			description: `Glob selecting all collected JSON receipts, relative to root.`,
			example: `--receipts '.breakage/receipts/**/*.json'`,
			completion: { fileSystem: `files` },
		},
	},
)

export async function runNpmMatrixCli(
	action: `plan` | `execute` | `verify`,
	opts: {
		root?: string
		config?: string
		out?: string
		plan?: string
		receipt?: string
		receipts?: string
	},
	id?: string,
): Promise<number> {
	try {
		const rootDirectory = path.resolve(opts.root ?? process.cwd())
		if (action === `plan`) {
			const config = await loadConfig(
				path.resolve(
					rootDirectory,
					opts.config ?? defaultConfig(rootDirectory),
				),
			)
			if (!config.npmMatrix)
				throw new Error(`Configure npmMatrix.configs and npmMatrix.prepare.`)
			const prepared = await npmPlan(config.npmMatrix, {
				rootDirectory,
				...(opts.out ? { bundleDirectory: opts.out } : {}),
			})
			process.stdout.write(`${JSON.stringify(npmMatrix(prepared))}\n`)
			return 0
		}
		const filename = path.resolve(rootDirectory, opts.plan!)
		const value: unknown = JSON.parse(await readFile(filename, `utf8`))
		const location = { rootDirectory, bundleDirectory: path.dirname(filename) }
		if (action === `execute`) {
			const receipt = await npmExecute(value, id!, location)
			await writeMatrixJson(path.resolve(rootDirectory, opts.receipt!), receipt)
			if (receipt.report) process.stdout.write(formatNpmReport(receipt.report))
			if (receipt.error) process.stderr.write(`${receipt.error}\n`)
			return receipt.exitCode
		}
		const receipts: unknown[] = []
		for await (const filename of glob(opts.receipts!, { cwd: rootDirectory }))
			receipts.push(
				JSON.parse(
					await readFile(path.resolve(rootDirectory, filename), `utf8`),
				),
			)
		const result = await npmVerify(value, receipts, location)
		if (result.errors.length)
			process.stderr.write(`${result.errors.join(`\n`)}\n`)
		else
			process.stdout.write(
				`Verified passing receipts for all ${result.environments} planned environments.\n`,
			)
		return result.exitCode
	} catch (error) {
		process.stderr.write(`npm matrix setup error: ${errorMessage(error)}\n`)
		return 2
	}
}
