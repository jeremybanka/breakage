import { existsSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import path from "node:path"

import { expect, it } from "bun:test"
import { simpleGit } from "simple-git"

import { createPeerWorktree } from "../src/peer-worktree.ts"
import { peerProject } from "./peer-project.ts"

it(`shares Git objects through detached worktrees and removes only owned registrations`, async () => {
	const project = await peerProject({})
	try {
		const commit = await project.git.revparse([`HEAD`])
		const before = await project.git.raw([`worktree`, `list`, `--porcelain`])
		const common = await project.git.revparse([
			`--path-format=absolute`,
			`--git-common-dir`,
		])
		const worktrees = await Promise.all([
			createPeerWorktree(project.repository, commit),
			createPeerWorktree(project.repository, commit),
		])
		try {
			for (const worktree of worktrees) {
				const git = simpleGit(worktree.directory)
				expect(
					await git.revparse([`--path-format=absolute`, `--git-common-dir`]),
				).toBe(common)
				expect(await git.revparse([`--abbrev-ref`, `HEAD`])).toBe(`HEAD`)
				await writeFile(
					path.join(worktree.directory, `generated.txt`),
					`build output`,
				)
			}
		} finally {
			await Promise.all(worktrees.map((worktree) => worktree.cleanup()))
		}
		expect(await project.git.raw([`worktree`, `list`, `--porcelain`])).toBe(
			before,
		)
		expect(worktrees.every((worktree) => !existsSync(worktree.directory))).toBe(
			true,
		)
		expect((await project.git.status()).isClean()).toBe(true)
	} finally {
		await project.cleanup()
	}
})
