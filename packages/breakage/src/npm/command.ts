import { spawn } from "node:child_process"
import path from "node:path"

export type TaskContext = {
	cwd: string
	run: (commandLine: string) => Promise<CommandResult>
}
export type Task<Context extends TaskContext = TaskContext> =
	| string
	| ((context: Context) => void | CommandResult | Promise<void | CommandResult>)

export type CommandResult = { code: number; output: string }

/** Capture output per environment so parallel runs cannot interleave their reports. */
export async function command<Context extends TaskContext = TaskContext>(
	commandLine: Task<Context>,
	cwd: string,
	context?: Context,
): Promise<CommandResult> {
	if (typeof commandLine === `function`) {
		const result = await commandLine(
			context ??
				({ cwd, run: (line: string) => command(line, cwd) } as Context),
		)
		if (result === undefined) return { code: 0, output: `` }
		if (
			!result ||
			!Number.isInteger(result.code) ||
			result.code < 0 ||
			typeof result.output !== `string`
		)
			throw new Error(`Task must return void or { code, output }.`)
		return result
	}
	return await new Promise((resolve, reject) => {
		const child = spawn(commandLine, {
			cwd,
			shell: true,
			env: {
				...process.env,
				NODE_PATH: ``,
				PATH: [
					path.join(cwd, `node_modules/.bin`),
					path.join(cwd, `../node_modules/.bin`),
					process.env.PATH,
				].join(path.delimiter),
			},
			stdio: [`ignore`, `pipe`, `pipe`],
		})
		let output = ``
		const collect = (chunk: Buffer): void => {
			// Bound diagnostics without interrupting a command that emits lots of output.
			output = (output + chunk.toString()).slice(-1_000_000)
		}
		child.stdout.on(`data`, collect)
		child.stderr.on(`data`, collect)
		child.on(`error`, reject)
		child.on(`close`, (code, signal) =>
			resolve({ code: signal ? 2 : (code ?? 2), output }),
		)
	})
}

export async function prepare(commandLine: Task, cwd: string): Promise<void> {
	const result = await command(commandLine, cwd)
	if (result.code !== 0)
		throw new Error(
			`Command failed (${result.code}) in ${cwd}: ${typeof commandLine === `string` ? commandLine : `inline task`}\n${result.output}`,
		)
}

export function errorMessage(error: unknown): string {
	return error instanceof Error
		? `${error.message}${error.cause ? `\n${errorMessage(error.cause)}` : ``}`
		: String(error)
}
