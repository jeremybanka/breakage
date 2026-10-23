import { exec } from "node:child_process"
import path from "node:path"

import { minimatch } from "minimatch"
import { simpleGit } from "simple-git"
import type { Chronicle } from "takua"
import logger from "takua"

import { command, errorMessage } from "./npm/command.ts"
import type { Task, TaskContext } from "./npm/command.ts"
import { readManifest, parseManifest } from "./npm/manifest.ts"
import { resolveReleaseVersion, versionDelta } from "./release.ts"
import type { ReleaseConfig, VersionDelta } from "./release.ts"
import { readBaseline } from "./baseline.ts"
import { withDirectoryLock } from "./directory-lock.ts"
import { latestReleaseTag as selectLatestReleaseTag } from "./release-tag.ts"
import { withTestFileState } from "./test-file-state.ts"

export { defineConfig, loadConfig } from "./config.ts"
export type { BreakageConfig } from "./config.ts"
export { semverPolicy, versionDelta, resolveReleaseVersion } from "./release.ts"
export type {
	ReleaseConfig,
	ReleasePolicy,
	ReleaseVersion,
	ReleaseVersionContext,
	VersionDelta,
} from "./release.ts"
export type { Task, TaskContext, CommandResult } from "./npm/command.ts"

export type PublicTestContext = TaskContext & {
	baseline: { ref: string; commit: string }
}

export type { BreakageBaseline, BreakagePreludeOptions } from "./baseline.ts"
export { breakagePrelude } from "./baseline.ts"
export { formatNpmReport, npmCheck, npmTest } from "./npm/check.ts"
export type {
	NpmConfig,
	NpmPeerEvidence,
	NpmReport,
	NpmRepresentativeResult,
	NpmSuite,
	NpmSuiteResult,
	NpmTestSelection,
	ReleaseContext,
	ReleaseEvidence,
	ReleaseIntent,
	SupportChange,
} from "./npm/types.ts"

export type BreakageOptions = {
	tagPattern?: string | undefined
	baselineFile?: string | undefined
	testPattern: string
	testCommand?: string
	/** String command or inline task. Do not combine with testCommand. */
	test?: Task<PublicTestContext>
	/** Legacy certification; use release for version-based decisions. */
	certifyCommand?: string
	release?: ReleaseConfig
	baseDirname?: string
	verbose?: boolean | undefined
}

export type BreakageOutcome =
	| { gitWasClean: false }
	| { gitWasClean: true; setupError: string }
	| {
			gitWasClean: true
			lastReleaseFound: false
	  }
	| {
			gitWasClean: true
			lastReleaseFound: true
			lastReleaseTag: string
			testsWereFound: false
	  }
	| {
			gitWasClean: true
			lastReleaseFound: true
			lastReleaseTag: string
			testsWereFound: true
			testsFound: string[]
			breakingChangesFound: false
			release?: VersionDelta
	  }
	| {
			gitWasClean: true
			lastReleaseFound: true
			lastReleaseTag: string
			testsWereFound: true
			testsFound: string[]
			breakingChangesFound: true
			testResult: string
			breakingChangesCertified: boolean
			certificationStdout: string
			certificationStderr: string
			release?: VersionDelta
	  }

export async function breakage({
	tagPattern,
	baselineFile,
	testPattern,
	testCommand,
	test,
	release,
	certifyCommand,
	baseDirname = process.cwd(),
	verbose = false,
}: BreakageOptions): Promise<BreakageOutcome & { summary: string }> {
	if (!testPattern || (!test && !testCommand))
		throw new Error(
			`required arguments were not provided: testPattern and test or testCommand.`,
		)
	if (test !== undefined && testCommand !== undefined)
		throw new Error(`Choose test or testCommand, not both.`)
	if (test !== undefined && certifyCommand !== undefined)
		throw new Error(`Use release with inline tasks instead of certifyCommand.`)
	if (release !== undefined && certifyCommand !== undefined)
		throw new Error(`Choose release or certifyCommand, not both.`)
	let mark: Chronicle[`mark`] | undefined
	let logMarks: Chronicle[`logMarks`] | undefined
	if (verbose) {
		const chronicle = logger.makeChronicle()
		mark = chronicle.mark
		logMarks = chronicle.logMarks
	}
	mark?.(`breakage`)
	const git = simpleGit(baseDirname)
	mark?.(`spawn git`)
	const isGitRepo = await git.checkIsRepo()
	mark?.(`is git repository`)
	if (!isGitRepo) {
		return {
			summary: `The git repository must be clean to run this command.`,
			gitWasClean: false,
		}
	}
	if (
		!(await withTestFileState(git, baseDirname, (state) => state.isClean()))
	) {
		return {
			summary: `The git repository must be clean to run this command.`,
			gitWasClean: false,
		}
	}
	let latestReleaseTag: string | undefined
	let releaseCommit: string
	if (baselineFile !== undefined) {
		const baseline = await readBaseline(
			git,
			path.resolve(baseDirname, baselineFile),
			{ tagPattern },
		)
		latestReleaseTag = baseline.ref
		releaseCommit = baseline.commit
		mark?.(`read pinned release baseline`)
	} else {
		const tagsRemote = await git.listRemote([`--tags`, `origin`])

		mark?.(`list remote tags`)
		latestReleaseTag = selectLatestReleaseTag(tagsRemote, tagPattern)
		mark?.(`found latest release tag`)
		if (!latestReleaseTag) {
			return {
				summary: `No tags found matching the pattern "${tagPattern}".`,
				gitWasClean: true,
				lastReleaseFound: false,
			} as const
		}
		const commonGitDirectory = await git.revparse([
			`--path-format=absolute`,
			`--git-common-dir`,
		])
		await withDirectoryLock(
			path.join(commonGitDirectory, `breakage-fetch.lock`),
			() =>
				git.fetch([
					`origin`,
					`${latestReleaseTag}:${latestReleaseTag}`,
					`--no-tags`,
					`--no-write-fetch-head`,
				]),
		)

		releaseCommit = await git.revparse([`${latestReleaseTag}^{commit}`])
		mark?.(`fetched latest release tag`)
	}

	let productionFiles: string[]
	try {
		productionFiles = (
			await git.raw([`ls-tree`, `-r`, `--name-only`, `-z`, releaseCommit])
		)
			.split(`\0`)
			.filter(Boolean)
	} catch (thrown) {
		mark?.(`failed to list production files`)
		const message =
			thrown instanceof Error
				? thrown.message
				: typeof thrown === `string`
					? thrown
					: undefined
		const summary = `Failed to list production files${
			message ? `: ${message}` : `.`
		}`
		return {
			summary,
			gitWasClean: true,
			lastReleaseFound: true,
			lastReleaseTag: latestReleaseTag,
			testsWereFound: false,
		} as const
	}
	mark?.(`listed all files checked into git`)
	const productionTestFiles = productionFiles.filter((file) =>
		minimatch(file, testPattern),
	)
	mark?.(`filtered to public test files`)

	let releaseEvidence: VersionDelta | undefined
	if (release) {
		const current = await readManifest(path.join(baseDirname, `package.json`))
		const prefix = await git.revparse([`--show-prefix`])
		const previous = parseManifest(
			JSON.parse(await git.show([`${releaseCommit}:${prefix}package.json`])),
			`baseline`,
		)
		if (previous.name !== current.name)
			throw new Error(`Release baseline belongs to another package.`)
		const version = await resolveReleaseVersion(release, {
			packageName: current.name,
			packageDirectory: path.resolve(baseDirname),
			currentVersion: current.version,
			baseline: {
				version: previous.version,
				ref: latestReleaseTag,
				commit: releaseCommit,
			},
		})
		if (version !== undefined)
			releaseEvidence = versionDelta(previous.version, version, release.policy)
	}

	const prepared = await withTestFileState(git, baseDirname, async (state) => {
		if (!(await state.isClean())) {
			return {
				summary: `The git repository must be clean to run this command.`,
				gitWasClean: false,
			} as const
		}

		if (productionTestFiles.length === 0) {
			return {
				summary: `No tests were found matching the pattern "${testPattern}".`,
				gitWasClean: true,
				lastReleaseFound: true,
				lastReleaseTag: latestReleaseTag,
				testsWereFound: false,
			} as const
		}
		const restore = await state.replaceTests(releaseCommit, productionTestFiles)
		mark?.(`restored public tests from latest release tag`)
		return { latestReleaseTag, productionTestFiles, restore }
	})
	if (prepared.summary !== undefined) return prepared
	const { restore } = prepared

	try {
		if (test !== undefined || release !== undefined) {
			try {
				const result = await command(test ?? testCommand!, baseDirname, {
					cwd: path.resolve(baseDirname),
					baseline: { ref: latestReleaseTag, commit: releaseCommit },
					run: (line: string) => command(line, baseDirname),
				})
				if (result.code > 1)
					return {
						gitWasClean: true,
						setupError: result.output,
						summary: `Public test setup failed (${result.code}).`,
					}
				const common = {
					gitWasClean: true as const,
					lastReleaseFound: true as const,
					lastReleaseTag: latestReleaseTag,
					testsWereFound: true as const,
					testsFound: productionTestFiles,
					...(releaseEvidence ? { release: releaseEvidence } : {}),
				}
				if (result.code === 0)
					return {
						...common,
						breakingChangesFound: false,
						summary: `No breaking changes were detected.`,
					}
				const permitted = releaseEvidence?.breaking ?? false
				return {
					...common,
					breakingChangesFound: true,
					breakingChangesCertified: permitted,
					testResult: result.output,
					certificationStdout: ``,
					certificationStderr: ``,
					summary: permitted
						? `Breaking changes are covered by release ${releaseEvidence!.previousVersion} → ${releaseEvidence!.version}.`
						: `Breaking changes require a breaking release.`,
				}
			} catch (error) {
				return {
					gitWasClean: true,
					setupError: errorMessage(error),
					summary: `Public test setup failed: ${errorMessage(error)}`,
				}
			}
		}
		const noBreakingChangesDetected = await new Promise<
			BreakageOutcome & { summary: string }
		>((resolve, reject) => {
			const result = exec(
				testCommand!,
				{ cwd: baseDirname },
				(_, __, stderr) => {
					if (result.exitCode === 0) {
						resolve({
							summary: `No breaking changes were detected.`,
							gitWasClean: true,
							lastReleaseFound: true,
							lastReleaseTag: latestReleaseTag,
							testsWereFound: true,
							testsFound: productionTestFiles,
							breakingChangesFound: false,
						})
					} else {
						reject(stderr)
					}
				},
			)
		})
		mark?.(`passed tests`)
		return noBreakingChangesDetected
	} catch (thrown) {
		mark?.(`failed tests`)
		const breakingChangesCertified = await new Promise<
			BreakageOutcome & { summary: string }
		>((resolve) => {
			const result = exec(
				certifyCommand ?? `false`,
				{ cwd: baseDirname },
				(_, stdout, stderr) => {
					const wereCertified = result.exitCode === 0
					mark?.(`${wereCertified ? `passed` : `failed`} certification`)
					resolve({
						summary: wereCertified
							? `Breaking changes were found and certified.`
							: `Breaking changes were found, but not certified.`,
						gitWasClean: true,
						lastReleaseFound: true,
						lastReleaseTag: latestReleaseTag,
						testsWereFound: true,
						testsFound: productionTestFiles,
						breakingChangesFound: true,
						testResult: thrown as string,
						breakingChangesCertified: wereCertified,
						certificationStdout: stdout,
						certificationStderr: stderr,
					})
				},
			)
		})
		return breakingChangesCertified
	} finally {
		await restore()
		mark?.(`restored original public tests`)
		logMarks?.()
	}
}
