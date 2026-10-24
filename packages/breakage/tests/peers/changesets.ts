import { strict as assert } from "node:assert"
import { execFileSync } from "node:child_process"
import {
	cpSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import path from "node:path"

import {
	changesetsReleaseDelta,
	readChangesetsReleasePlan,
} from "breakage/changesets"
import { semverPolicy, versionDelta, versionTransition } from "breakage"

const require = createRequire(import.meta.url)
const cli = path.join(
	path.dirname(require.resolve(`@changesets/cli/package.json`)),
	`bin.js`,
)

for (const prerelease of [false, true]) {
	const directory = mkdtempSync(path.join(tmpdir(), `breakage-peer-contract-`))
	try {
		cpSync(new URL(`./fixtures/workspace`, import.meta.url), directory, {
			recursive: true,
		})
		const git = (...args: string[]): void => {
			execFileSync(`git`, args, { cwd: directory, stdio: `pipe` })
		}
		git(`init`, `--initial-branch=main`)
		git(`config`, `user.name`, `Peer Contract`)
		git(`config`, `user.email`, `test@example.invalid`)
		git(`add`, `.`)
		git(`commit`, `-m`, `Fixture`)
		const run = (...args: string[]): void => {
			execFileSync(process.execPath, [cli, ...args], {
				cwd: directory,
				stdio: `pipe`,
			})
		}
		if (prerelease) run(`pre`, `enter`, `next`)
		const target = prerelease ? `0.54.0-next.0` : `0.54.0`
		const plan = await readChangesetsReleasePlan(
			path.join(directory, `packages/core`),
		)
		assert.equal(plan.get(`peer-core`), target)
		assert.equal(
			plan.get(`peer-integration`),
			prerelease ? `1.0.1-next.0` : `1.0.1`,
		)
		const resolver = changesetsReleaseDelta()
		const context = {
			packageName: `peer-core`,
			packageDirectory: path.join(directory, `packages/core`),
			currentVersion: `0.53.3`,
			baseline: { version: `0.53.3` },
		}
		assert.deepEqual(
			await resolver(context),
			versionTransition(`0.53.3`, target),
		)
		assert.equal(
			versionDelta(`0.53.3`, target, semverPolicy({ beforeV1: `minor` }))
				.breaking,
			true,
		)
		run(`version`)
		const current = JSON.parse(
			readFileSync(path.join(context.packageDirectory, `package.json`), `utf8`),
		) as { version: string }
		assert.equal(current.version, target)
		assert.deepEqual(
			await resolver({ ...context, currentVersion: current.version }),
			versionTransition(`0.53.3`, target),
		)
		if (!prerelease)
			assert.equal((await readChangesetsReleasePlan(directory)).size, 0)
		writeFileSync(path.join(directory, `.changeset/config.json`), `{ invalid`)
		await assert.rejects(() => resolver({ ...context, currentVersion: target }))
	} finally {
		rmSync(directory, { recursive: true, force: true })
	}
}
console.log(
	`Packed Changesets helpers preserve release intent, dependent bumps, prerelease state, and configuration errors.`,
)
