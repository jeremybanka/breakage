import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"

import type { SimpleGit } from "simple-git"
import { simpleGit } from "simple-git"

import { withDirectoryLock } from "./directory-lock.ts"
import { latestReleaseTag } from "./release-tag.ts"
import { isPeerPlan, preparePeerPlan } from "./peer-plan.ts"
import type { PeerPlan } from "./peer-plan.ts"

export type BaselineOptions = {
	tagPattern?: string | undefined
	baseDirname?: string
	peerConfig?: string | undefined
	testPattern?: string | undefined
	testCommand?: string | undefined
}

export type BreakagePreludeOptions = BaselineOptions & { out: string }

export type BreakageBaseline = {
	version: 1
	kind?: `peers`
	tagPattern: string | null
	packageDirectory: string
	ref: string
	commit: string
	peers?: PeerPlan
}

const objectId = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/

function isBaseline(value: unknown): value is BreakageBaseline {
	if (typeof value !== `object` || value === null) return false
	const record = value as Partial<BreakageBaseline>
	return (
		record.version === 1 &&
		(record.tagPattern === null || typeof record.tagPattern === `string`) &&
		typeof record.packageDirectory === `string` &&
		typeof record.ref === `string` &&
		(record.kind === `peers`
			? record.ref === `HEAD` && record.peers !== undefined
			: record.kind === undefined &&
				record.ref.startsWith(`refs/tags/`) &&
				record.peers === undefined) &&
		typeof record.commit === `string` &&
		objectId.test(record.commit) &&
		(record.peers === undefined || isPeerPlan(record.peers))
	)
}

/** Resolve and fetch a release without running tests or changing the worktree. */
export async function breakagePrelude({
	out,
	tagPattern,
	baseDirname = process.cwd(),
	peerConfig,
	testPattern,
	testCommand,
}: BreakagePreludeOptions): Promise<BreakageBaseline> {
	const filename = path.resolve(baseDirname, out)
	const temporaryPath = `${filename}.${randomUUID()}.tmp`
	let canInvalidate = false
	try {
		const git = simpleGit(baseDirname)
		// An ignored, untracked snapshot cannot make the compatibility check dirty.
		if (!(await git.raw([`check-ignore`, `--`, filename])).trim()) {
			throw new Error(`Baseline output must be gitignored: ${filename}.`)
		}
		canInvalidate = true
		if (peerConfig !== undefined) {
			if (
				!(
					await git.raw([`check-ignore`, `--`, `${filename}.peers/probe`])
				).trim()
			)
				throw new Error(
					`Peer artifact directory must be gitignored: ${filename}.peers.`,
				)
			const peers = await preparePeerPlan(
				baseDirname,
				peerConfig,
				`${filename}.peers`,
				{ testPattern, testCommand },
			)
			const baseline: BreakageBaseline = {
				version: 1,
				kind: `peers`,
				tagPattern: tagPattern ?? null,
				packageDirectory: await git.revparse([`--show-prefix`]),
				ref: `HEAD`,
				commit: peers.candidateCommit,
				peers,
			}
			await mkdir(path.dirname(filename), { recursive: true })
			await writeFile(temporaryPath, `${JSON.stringify(baseline, null, 2)}\n`, {
				flag: `wx`,
			})
			await rename(temporaryPath, filename)
			return baseline
		}
		const remoteTags = await git.listRemote([`--tags`, `origin`])
		const ref = latestReleaseTag(remoteTags, tagPattern)
		if (!ref) {
			throw new Error(`No tags found matching the pattern "${tagPattern}".`)
		}
		const refs = new Map(
			remoteTags
				.trim()
				.split(`\n`)
				.map((line) => {
					const [sha, name] = line.split(`\t`)
					return [name, sha]
				}),
		)
		// ls-remote supplies the peeled commit for annotated tags.
		const commit = refs.get(`${ref}^{}`) ?? refs.get(ref)
		if (!commit || !objectId.test(commit)) {
			throw new Error(`Could not resolve the release commit for ${ref}.`)
		}
		const commonGitDirectory = await git.revparse([
			`--path-format=absolute`,
			`--git-common-dir`,
		])
		await withDirectoryLock(
			path.join(commonGitDirectory, `breakage-fetch.lock`),
			() => git.fetch([`origin`, commit, `--no-tags`, `--no-write-fetch-head`]),
		)
		if ((await git.raw([`cat-file`, `-t`, commit])).trim() !== `commit`) {
			throw new Error(`Release ${ref} does not resolve to a commit.`)
		}
		const baseline: BreakageBaseline = {
			version: 1,
			tagPattern: tagPattern ?? null,
			packageDirectory: await git.revparse([`--show-prefix`]),
			ref,
			commit,
		}
		await mkdir(path.dirname(filename), { recursive: true })
		await writeFile(temporaryPath, `${JSON.stringify(baseline, null, 2)}\n`, {
			flag: `wx`,
		})
		await rename(temporaryPath, filename)
		return baseline
	} catch (cause) {
		// A failed refresh must never leave an older snapshot available as fallback.
		if (canInvalidate) await rm(filename, { force: true })
		throw new Error(`Failed to prepare baseline ${filename}.`, { cause })
	} finally {
		await rm(temporaryPath, { force: true })
	}
}

export async function readBaseline(
	git: SimpleGit,
	filename: string,
	{ tagPattern, peerConfig }: BaselineOptions,
): Promise<BreakageBaseline> {
	try {
		const baseline: unknown = JSON.parse(await readFile(filename, `utf8`))
		if (!isBaseline(baseline)) throw new Error(`Invalid baseline fields.`)
		if ((peerConfig !== undefined) !== (baseline.peers !== undefined))
			throw new Error(`Baseline peer configuration does not match this check.`)
		if (
			baseline.tagPattern !== (tagPattern ?? null) ||
			baseline.packageDirectory !== (await git.revparse([`--show-prefix`]))
		) {
			throw new Error(`Baseline belongs to a different package or tag pattern.`)
		}
		if (
			baseline.kind !== `peers` &&
			(
				await git.raw([`check-ref-format`, `--normalize`, baseline.ref])
			).trim() !== baseline.ref
		) {
			throw new Error(`Invalid release ref.`)
		}
		if (
			(await git.raw([`cat-file`, `-t`, baseline.commit])).trim() !== `commit`
		) {
			throw new Error(`Pinned object is not a locally available commit.`)
		}
		return baseline
	} catch (cause) {
		throw new Error(
			`Missing, invalid, or unusable baseline ${filename}. Run breakage prelude again.`,
			{ cause },
		)
	}
}
