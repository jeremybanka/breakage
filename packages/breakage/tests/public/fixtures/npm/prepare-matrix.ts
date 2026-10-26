import { execFileSync } from "node:child_process"
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
} from "node:fs"
import path from "node:path"
import type { NpmConfig } from "breakage"

const root = import.meta.dirname
const { npm: config }: { npm: NpmConfig } = JSON.parse(
	readFileSync(path.join(root, `fixture-config.json`), `utf8`),
)
mkdirSync(path.join(root, `.breakage`), { recursive: true })
appendFileSync(path.join(root, `.breakage/prepare-runs`), `prepared\n`)
if (existsSync(path.join(root, `.breakage/fail-preparation`)))
	throw new Error(`Requested preparation failure.`)
const base = path.resolve(root, config.packageDirectory ?? `.`)
for (const request of [
	{ directory: `.`, artifact: config.artifact },
	...Object.values(config.localPeers ?? {}),
]) {
	const artifact = path.resolve(base, request.artifact)
	mkdirSync(path.dirname(artifact), { recursive: true })
	const output = execFileSync(
		`npm`,
		[
			`pack`,
			`--json`,
			`--ignore-scripts`,
			`--offline`,
			`--cache`,
			path.join(root, `.cache`),
			`--pack-destination`,
			path.dirname(artifact),
		],
		{ cwd: path.resolve(base, request.directory), encoding: `utf8` },
	)
	const packed = path.join(
		path.dirname(artifact),
		(JSON.parse(output) as { filename: string }[])[0]!.filename,
	)
	if (packed !== artifact) renameSync(packed, artifact)
}
