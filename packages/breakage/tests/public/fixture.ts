import { execFileSync } from "node:child_process"
import {
	cpSync,
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
	cpSync(new URL(`./fixtures/api/`, import.meta.url), repository, {
		recursive: true,
	})
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

	git(repository, `add`, `.`)
	git(repository, `commit`, `-m`, `Release`)
	git(repository, `tag`, `-a`, `example@1.0.0`, `-m`, `Release`)
	git(repository, `push`, `--tags`, `origin`)

	// Today's assertions match current data even if the implementation broke the release.
	write(
		`value.json`,
		JSON.stringify({ value: changed ? `changed` : `released` }),
	)
	cpSync(
		path.join(repository, `current/contract.ts`),
		path.join(repository, `public/contract.ts`),
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
		},
		write,
		read: (filename) => readFileSync(path.join(repository, filename), `utf8`),
		cleanup: () => rmSync(directory, { recursive: true, force: true }),
	}
}
