import { execFileSync } from "node:child_process"
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import type { BreakageOptions } from "breakage"

export function git(repository: string, ...args: string[]): string {
	return execFileSync(`git`, [`-C`, repository, ...args], {
		encoding: `utf8`,
		stdio: [`ignore`, `pipe`, `pipe`],
	})
}

export function shellQuote(value: string): string {
	return `'${value.replaceAll(`'`, `'"'"'`)}'`
}

export function fixture(changed = false): {
	directory: string
	repository: string
	options: BreakageOptions
	write: (filename: string, contents: string) => void
	read: (filename: string) => string
	cleanup: () => void
} {
	const directory = mkdtempSync(path.join(tmpdir(), `breakage-consumer-`))
	const repository = path.join(directory, `repository`)
	const remote = path.join(directory, `remote.git`)
	mkdirSync(repository)
	git(directory, `init`, `--bare`, remote)
	git(repository, `init`, `--initial-branch=main`)
	git(repository, `config`, `user.name`, `Breakage Consumer`)
	git(repository, `config`, `user.email`, `consumer@example.invalid`)
	git(repository, `remote`, `add`, `origin`, remote)

	function write(filename: string, contents: string): void {
		const destination = path.join(repository, filename)
		mkdirSync(path.dirname(destination), { recursive: true })
		writeFileSync(destination, contents)
	}

	write(`.gitignore`, `artifacts/\n.breakage/\n`)
	write(`implementation.ts`, `export const value = "released"\n`)
	write(`public/expected.ts`, `export const expected = "released"\n`)
	write(
		`public/contract.ts`,
		`import { strict as assert } from "node:assert"\nimport { value } from "../implementation.ts"\nimport { expected } from "./expected.ts"\nassert.equal(value, expected, "released consumer behavior")\n`,
	)
	write(`notes.txt`, `original`)
	git(repository, `add`, `.`)
	git(repository, `commit`, `-m`, `Release`)
	git(repository, `tag`, `-a`, `example@1.0.0`, `-m`, `Release`)
	git(repository, `push`, `--tags`, `origin`)

	// Today's assertions pass even if today's implementation has broken the release.
	write(
		`implementation.ts`,
		`export const value = ${JSON.stringify(changed ? `changed` : `released`)}\n`,
	)
	write(
		`public/contract.ts`,
		`import { strict as assert } from "node:assert"\nimport { value } from "../implementation.ts"\nassert.equal(value, ${JSON.stringify(changed ? `changed` : `released`)})\n`,
	)
	rmSync(path.join(repository, `public/expected.ts`))
	git(repository, `add`, `.`)
	git(repository, `commit`, `-m`, `Current implementation and tests`)

	return {
		directory,
		repository,
		options: {
			baseDirname: repository,
			tagPattern: `refs/tags/example@`,
			testPattern: `public/**/*.ts`,
			testCommand: `${shellQuote(process.execPath)} public/contract.ts`,
			certifyCommand: `false`,
		},
		write,
		read: (filename) => readFileSync(path.join(repository, filename), `utf8`),
		cleanup: () => rmSync(directory, { recursive: true, force: true }),
	}
}
