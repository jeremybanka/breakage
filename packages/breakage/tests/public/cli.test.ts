import { readdirSync } from "node:fs"
import path from "node:path"

import { afterEach, expect, it } from "bun:test"

import { fixture, git } from "./fixture.ts"

// The current runner selects source; historical assertions do not freeze its path.
const configuredEntrypoint = process.env.BREAKAGE_CLI_ENTRYPOINT
if (!configuredEntrypoint)
	throw new Error(`BREAKAGE_CLI_ENTRYPOINT is required`)
const entrypoint = path.resolve(configuredEntrypoint)

let project: ReturnType<typeof fixture> | undefined
afterEach(() => project?.cleanup())

function run(args: string[]) {
	if (!project) throw new Error(`Fixture is required`)
	const result = Bun.spawnSync([process.execPath, entrypoint, `--`, ...args], {
		cwd: project.repository,
		env: { ...process.env, NO_COLOR: `1` },
	})
	return {
		exitCode: result.exitCode,
		stdout: result.stdout.toString(),
		stderr: result.stderr.toString(),
	}
}

it.each([
	{ changed: false, breakingRelease: false, exitCode: 0 },
	{ changed: true, breakingRelease: false, exitCode: 1 },
	{ changed: true, breakingRelease: true, exitCode: 0 },
])(
	`returns $exitCode for changed=$changed, breakingRelease=$breakingRelease using a config file`,
	({ changed, breakingRelease, exitCode }) => {
		project = fixture(changed)
		const currentTests = project.read(`public/contract.ts`)
		project.write(
			`config-data.json`,
			JSON.stringify({
				options: project.options,
				version: breakingRelease ? `2.0.0` : `1.0.0`,
			}),
		)
		// Configuration is committed because checking requires a clean repository.
		git(project.repository, `add`, `config-data.json`)
		git(project.repository, `commit`, `-m`, `Configure check`)
		const result = run([])
		expect(result.exitCode).toBe(exitCode)
		expect(project.read(`public/contract.ts`)).toBe(currentTests)
		if (changed) expect(result.stdout).toContain(`released consumer behavior`)
	},
)

it(`returns 2 when no release can establish compatibility`, () => {
	project = fixture()
	const result = run([
		`--tag-pattern=refs/tags/absent@`,
		`--test-pattern=public/**/*.ts`,
		`--test-command=false`,
	])
	expect(result.exitCode).toBe(2)
})

it(`shows help independently of malformed configuration without writing files`, () => {
	project = fixture()
	project.write(`breakage.config.ts`, `{ malformed`)
	const before = readdirSync(project.repository).sort()
	const result = run([`help`])
	expect(result.exitCode).toBe(0)
	expect(result.stdout).toContain(`--testCommand`)
	expect(result.stderr).toBe(``)
	expect(readdirSync(project.repository).sort()).toEqual(before)
})
