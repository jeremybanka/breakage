import { assembleReleasePlan } from "@changesets/assemble-release-plan"
import { readConfig } from "@changesets/config"
import { readPreState } from "@changesets/pre"
import { readChangesets } from "@changesets/read"
import { getPackages } from "@manypkg/get-packages"

import {
	versionTransition,
	type ReleaseDeltaContext,
	type VersionTransition,
} from "./release.ts"

/** Read the actual Changesets plan, including dependent bumps and prerelease state. */
export async function readChangesetsReleasePlan(
	directory: string = process.cwd(),
): Promise<ReadonlyMap<string, string>> {
	const packages = await getPackages(directory)
	const root = packages.rootDir
	const { config, errors } = await readConfig(root, packages)
	if (errors) throw new Error(errors.join(`\n`))
	const [changesets, preState] = await Promise.all([
		readChangesets(root),
		readPreState(root),
	])
	const plan = assembleReleasePlan(changesets, packages, config, preState)
	return new Map(
		plan.releases.flatMap(({ name, newVersion }) =>
			newVersion === undefined ? [] : [[name, newVersion] as const],
		),
	)
}

/** Compare the selected baseline (or current manifest) with the planned or versioned release. */
export function changesetsReleaseDelta({
	directory,
}: { directory?: string } = {}): (
	context: ReleaseDeltaContext,
) => Promise<VersionTransition> {
	return async ({
		packageName,
		packageDirectory,
		currentVersion,
		baseline,
	}) => {
		const version =
			(await readChangesetsReleasePlan(directory ?? packageDirectory)).get(
				packageName,
			) ?? currentVersion
		return versionTransition(baseline?.version ?? currentVersion, version)
	}
}
