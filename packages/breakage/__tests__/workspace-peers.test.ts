import { execFileSync } from "node:child_process"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { expect, it } from "bun:test"
import { simpleGit } from "simple-git"

import { breakage } from "../src/breakage.ts"

it(`detects workspace changes hidden by upgrading both peers together`, async () => {
	const directory = await mkdtemp(
		path.join(tmpdir(), `breakage-workspace-peers-`),
	)
	try {
		const repository = path.join(directory, `repository`)
		const remote = path.join(directory, `remote`)
		await mkdir(repository)
		await mkdir(remote)
		await simpleGit(remote).init(true)
		const git = simpleGit(repository)
		await git
			.init()
			.addConfig(`user.name`, `Test`)
			.addConfig(`user.email`, `test@example.invalid`)
		await git.addRemote(`origin`, remote)
		for (const name of [`host`, `plugin`]) {
			await mkdir(path.join(repository, `packages`, name), { recursive: true })
			await writeFile(
				path.join(repository, `packages`, name, `package.json`),
				JSON.stringify({
					name,
					version: `1.0.0`,
					type: `module`,
					main: `index.ts`,
				}),
			)
		}
		await writeFile(path.join(repository, `.gitignore`), `.breakage/\n`)
		await writeFile(
			path.join(repository, `packages/host/index.ts`),
			`export function greet() { return "hello" }\n`,
		)
		await writeFile(
			path.join(repository, `packages/plugin/index.ts`),
			`import { greet } from "host"; export const message = () => greet();\n`,
		)
		await writeFile(
			path.join(repository, `contract.ts`),
			`import assert from "node:assert/strict"; import { message } from "plugin"; assert.equal(message(), "hello");\n`,
		)
		// This is a project-owned command: breakage only restores its released contract.
		await writeFile(
			path.join(repository, `run-case.ts`),
			`
import { execFileSync } from "node:child_process"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
const directory = path.resolve(".breakage/case")
await rm(directory, { recursive: true, force: true })
try {
  for (const [name, revision] of [["plugin", process.argv[2]], ["host", process.argv[3]]]) {
    const target = path.join(directory, "node_modules", name)
    await mkdir(target, { recursive: true })
    for (const file of ["package.json", "index.ts"]) {
      const source = "packages/" + name + "/" + file
      const contents = revision === "released" ? execFileSync("git", ["show", "fixture@1.0.0:" + source]) : await readFile(source)
      await writeFile(path.join(target, file), contents)
    }
  }
  await writeFile(path.join(directory, "contract.ts"), await readFile("contract.ts"))
  execFileSync(process.execPath, [path.join(directory, "contract.ts")], { stdio: "inherit" })
} finally {
  await rm(directory, { recursive: true, force: true })
}
`,
		)
		await git
			.add(`.`)
			.commit(`Release compatible workspace`)
			.addTag(`fixture@1.0.0`)
		await git.push(`origin`, `--tags`)
		await writeFile(
			path.join(repository, `packages/host/index.ts`),
			`export function welcome() { return "hello" }\n`,
		)
		await writeFile(
			path.join(repository, `packages/plugin/index.ts`),
			`import { welcome } from "host"; export const message = () => welcome();\n`,
		)
		await git.add(`.`).commit(`Upgrade plugin and host together`)
		execFileSync(process.execPath, [`run-case.ts`, `current`, `current`], {
			cwd: repository,
		})
		for (const [plugin, host, passes] of [
			[`current`, `current`, true],
			[`released`, `released`, true],
			[`current`, `released`, false],
			[`released`, `current`, false],
		] as const) {
			const outcome = await breakage({
				baseDirname: repository,
				tagPattern: `fixture@`,
				testPattern: `{contract,run-case}.ts`,
				testCommand: `"${process.execPath}" run-case.ts ${plugin} ${host}`,
				certifyCommand: `false`,
			})
			expect(
				`breakingChangesFound` in outcome && outcome.breakingChangesFound,
			).toBe(!passes)
			if (`testResult` in outcome)
				expect(outcome.testResult).toContain(`Export named`)
		}
		expect((await git.status()).isClean()).toBe(true)
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
})
