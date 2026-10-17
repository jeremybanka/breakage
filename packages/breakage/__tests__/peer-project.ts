import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { simpleGit } from "simple-git"

import type { PeerBreakageOptions } from "../src/breakage.ts"
import type { PeerConfig } from "../src/peer-matrix.ts"

export async function peerProject(
	config: PeerConfig,
	contract = `import assert from "node:assert/strict"; assert.equal(JSON.parse(process.env.BREAKAGE_PEERS).host, "1.0.0", "released peer contract");`,
) {
	const directory = await mkdtemp(path.join(tmpdir(), `breakage-peer-project-`))
	const repository = path.join(directory, `repository`)
	await mkdir(repository)
	const write = async (name: string, contents: string) => {
		await mkdir(path.dirname(path.join(repository, name)), { recursive: true })
		await writeFile(path.join(repository, name), contents)
	}
	await write(`.gitignore`, `.breakage/\nnode_modules/\n`)
	await write(
		`package.json`,
		JSON.stringify({
			name: `fixture-plugin`,
			version: `1.0.0`,
			type: `module`,
			peerDependencies: { host: `^1.0.0` },
		}),
	)
	await write(`public/contract.ts`, contract)
	await write(`peers.json`, JSON.stringify(config))
	const git = simpleGit(repository)
	await git
		.init()
		.addConfig(`user.name`, `Test`)
		.addConfig(`user.email`, `test@example.invalid`)
	await git.add(`.`).commit(`Release`).addTag(`plugin@1.0.0`)
	const remote = path.join(directory, `remote.git`)
	await git.clone(repository, remote, [`--bare`])
	await git.addRemote(`origin`, remote)
	const options: PeerBreakageOptions = {
		baseDirname: repository,
		tagPattern: `plugin@`,
		testPattern: `public/**/*`,
		testCommand: `"${process.execPath}" public/contract.ts`,
		certifyCommand: `true`,
		peerConfig: `peers.json`,
	}
	return {
		directory,
		repository,
		git,
		options,
		write,
		cleanup: () => rm(directory, { recursive: true, force: true }),
	}
}
