import { readFileSync } from "node:fs"
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
		if (name === `breakage.config.json`) {
			const { embassies, ...peerOptions } = JSON.parse(contents) as PeerConfig
			contents = JSON.stringify({
				embassies: embassies ?? {
					peers: {
						peers: Object.keys(
							JSON.parse(
								readFileSync(path.join(repository, `package.json`), `utf8`),
							).peerDependencies,
						),
						testPattern: `public/**/*`,
						testCommand: `"${process.execPath}" public/contract.ts`,
					},
				},
				peerOptions,
			})
		}
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
			devDependencies: {
				host_v1: `npm:host@1.0.0`,
				host_v1_1: `npm:host@1.1.0`,
			},
		}),
	)
	await write(`public/contract.ts`, contract)
	await write(
		`breakage.config.json`,
		JSON.stringify({ install: false, ...config }),
	)
	const git = simpleGit(repository)
	await git
		.init()
		.addConfig(`user.name`, `Test`)
		.addConfig(`user.email`, `test@example.invalid`)
	await git.add(`.`).commit(`Release`).addTag(`plugin@1.0.0`)
	const remote = path.join(directory, `remote.git`)
	await git.clone(repository, remote, [`--bare`])
	await git.addRemote(`origin`, remote)
	return {
		directory,
		repository,
		git,
		get options(): PeerBreakageOptions {
			return {
				baseDirname: repository,
				tagPattern: `plugin@`,
				...JSON.parse(
					readFileSync(path.join(repository, `breakage.config.json`), `utf8`),
				),
			}
		},
		write,
		cleanup: () => rm(directory, { recursive: true, force: true }),
	}
}
