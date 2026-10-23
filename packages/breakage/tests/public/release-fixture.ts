import {
	execFileSync,
	spawnSync,
	type SpawnSyncReturns,
} from "node:child_process"
import {
	cpSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const packageRoot = path.dirname(require.resolve(`breakage/package.json`))
const cli = path.join(packageRoot, `dist/breakage.x.js`)
const changesets = path.join(
	path.dirname(require.resolve(`@changesets/cli/package.json`)),
	`bin.js`,
)

export function releaseFixture(
	version = `0.53.3`,
	bump: `major` | `minor` | `patch` = `minor`,
): {
	directory: string
	library: string
	git: (...args: string[]) => string
	write: (filename: string, data: unknown) => void
	read: (filename: string) => string
	commit: () => void
	run: (...args: string[]) => SpawnSyncReturns<string>
	version: () => void
	clean: () => void
} {
	const directory = mkdtempSync(path.join(tmpdir(), `breakage-release-`))
	cpSync(
		fileURLToPath(new URL(`./fixtures/release`, import.meta.url)),
		directory,
		{ recursive: true },
	)
	const library = path.join(directory, `packages/library`)
	mkdirSync(path.join(directory, `node_modules`))
	symlinkSync(packageRoot, path.join(directory, `node_modules/breakage`), `dir`)
	const git = (...args: string[]): string =>
		execFileSync(`git`, args, {
			cwd: directory,
			encoding: `utf8`,
			stdio: [`ignore`, `pipe`, `pipe`],
		}).trim()
	const write = (filename: string, data: unknown): void =>
		writeFileSync(
			path.join(directory, filename),
			typeof data === `string` ? data : JSON.stringify(data),
		)
	const read = (filename: string): string =>
		readFileSync(path.join(directory, filename), `utf8`)
	const pending = read(`.changeset/release.md`).replace(`: minor`, `: ${bump}`)
	rmSync(path.join(directory, `.changeset/release.md`))
	write(`packages/library/package.json`, {
		name: `release-library`,
		version,
		type: `module`,
	})
	git(`init`, `--initial-branch=main`)
	git(`config`, `user.name`, `Release Test`)
	git(`config`, `user.email`, `test@example.invalid`)
	const commit = (): void => {
		git(`add`, `.`)
		git(`commit`, `--allow-empty`, `-m`, `Fixture`)
	}
	commit()
	git(`tag`, `release-library@${version}`)
	git(`remote`, `add`, `origin`, directory)
	write(`.changeset/release.md`, pending)
	write(`packages/library/src/value.json`, { value: `changed` })
	commit()
	return {
		directory,
		library,
		git,
		write,
		read,
		commit,
		run: (...args) =>
			spawnSync(`node`, [cli, ...args], { cwd: directory, encoding: `utf8` }),
		version: () => {
			execFileSync(`node`, [changesets, `version`], {
				cwd: directory,
				stdio: `pipe`,
			})
		},
		clean: () => rmSync(directory, { recursive: true, force: true }),
	}
}
