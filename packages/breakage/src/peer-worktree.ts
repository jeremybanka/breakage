import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { simpleGit } from "simple-git"

import { withDirectoryLock } from "./directory-lock.ts"

export type PeerWorktree = { directory: string; cleanup: () => Promise<void> }

export async function createPeerWorktree(
	source: string,
	commit: string,
): Promise<PeerWorktree> {
	const git = simpleGit(source)
	const common = await git.revparse([
		`--path-format=absolute`,
		`--git-common-dir`,
	])
	const lock = path.join(common, `breakage-worktrees.lock`)
	const temporary = await mkdtemp(path.join(tmpdir(), `breakage-peer-`))
	const directory = path.join(temporary, `checkout`)
	try {
		await withDirectoryLock(lock, () =>
			git.raw([`worktree`, `add`, `--quiet`, `--detach`, directory, commit]),
		)
	} catch (error) {
		await rm(temporary, { recursive: true, force: true })
		throw error
	}
	return {
		directory,
		async cleanup() {
			// Only remove the worktree created by this invocation, including its
			// generated files. Never prune or reset another checkout.
			await withDirectoryLock(
				lock,
				() => git.raw([`worktree`, `remove`, `--force`, directory]),
				true,
			)
			await rm(temporary, { recursive: true, force: true })
		},
	}
}
