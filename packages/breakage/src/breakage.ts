import path from "node:path"

import { minimatch } from "minimatch"
import { simpleGit } from "simple-git"
import type { Chronicle } from "takua"
import logger from "takua"

import { command, errorMessage } from "./task.ts"
import { readManifest, parseManifest } from "./npm/manifest.ts"
import {
	resolveReleaseDelta,
	versionDelta,
	validateRelease,
	rejectCertificationOptions,
} from "./release.ts"
import type { ReleaseConfig, VersionDelta } from "./release.ts"
import { readBaseline } from "./baseline.ts"
import { withDirectoryLock } from "./directory-lock.ts"
import { latestReleaseTag as selectLatestReleaseTag } from "./release-tag.ts"
import { withTestFileState } from "./test-file-state.ts"

export { defineConfig, loadConfig } from "./config.ts"
export type { BreakageConfig } from "./config.ts"
export {
	semverPolicy,
	versionTransition,
	versionDelta,
	resolveReleaseDelta,
} from "./release.ts"
export type {
	ReleaseConfig,
	ReleasePolicy,
	ReleasePolicyFunction,
	SemverPolicyOptions,
	VersionTransition,
	ReleaseDeltaResolver,
	ReleaseDeltaContext,
	VersionDelta,
} from "./release.ts"
export type { CommandResult } from "./task.ts"

export type { BreakageBaseline, BreakagePreludeOptions } from "./baseline.ts"
export { breakagePrelude } from "./baseline.ts"
export { formatNpmReport, npmCheck, npmTest } from "./npm/check.ts"
export {
	npmPlan,
	npmExecute,
	npmVerify,
	npmMatrix,
	verifyNpmReceipts,
} from "./npm/matrix.ts"
export type {
	NpmMatrixConfig,
	NpmMatrixLabelContext,
	NpmPrepareContext,
	NpmArchiveRequest,
	NpmPlan,
	NpmReceipt,
	NpmVerification,
	NpmMatrixLocation,
} from "./npm/matrix.ts"
export type {
	NpmConfig,
	NpmPeerEvidence,
	NpmReport,
	NpmRepresentativeResult,
	NpmSuite,
	NpmSuiteResult,
	NpmTestSelection,
	SupportChange,
} from "./npm/types.ts"

export type BreakageOptions = {
	tagPattern?: string | undefined
	baselineFile?: string | undefined
	testPattern: string
	testCommand?: string
	/** Shell command. Do not combine with testCommand. */
	test?: string
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
			release?: VersionDelta
	  }

export async function breakage(
	options: BreakageOptions,
): Promise<BreakageOutcome & { summary: string }> {
	rejectCertificationOptions(options)
	const {
		tagPattern,
		baselineFile,
		testPattern,
		testCommand,
		test,
		release,
		baseDirname = process.cwd(),
		verbose = false,
	} = options
	if (!testPattern || (!test && !testCommand))
		throw new Error(
			`required arguments were not provided: testPattern and test or testCommand.`,
		)
	if (test !== undefined && testCommand !== undefined)
		throw new Error(`Choose test or testCommand, not both.`)
	if (
		typeof (test ?? testCommand) !== `string` ||
		!(test ?? testCommand)!.trim()
	)
		throw new Error(`test must be a nonempty shell command string.`)
	if (release !== undefined) validateRelease(release)
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
		const transition = await resolveReleaseDelta(release, {
			packageName: current.name,
			packageDirectory: path.resolve(baseDirname),
			currentVersion: current.version,
			baseline: {
				version: previous.version,
				ref: latestReleaseTag,
				commit: releaseCommit,
			},
		})
		if (transition !== undefined)
			releaseEvidence = versionDelta(
				transition.previousVersion,
				transition.version,
				release.policy,
			)
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
		const result = await command(test ?? testCommand!, baseDirname)
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
		return {
			...common,
			breakingChangesFound: true,
			testResult: result.output,
			summary: releaseEvidence?.breaking
				? `Breaking changes are covered by release ${releaseEvidence.previousVersion} → ${releaseEvidence.version}.`
				: `Breaking changes require a breaking release.`,
		}
	} catch (error) {
		return {
			gitWasClean: true,
			setupError: errorMessage(error),
			summary: `Public test setup failed: ${errorMessage(error)}`,
		}
	} finally {
		await restore()
		mark?.(`restored original public tests`)
		logMarks?.()
	}
}
