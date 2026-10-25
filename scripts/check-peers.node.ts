import { execFileSync } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, renameSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const directory = fileURLToPath(
	new URL(`../packages/breakage`, import.meta.url),
)
const artifacts = path.join(directory, `artifacts`)
mkdirSync(artifacts, { recursive: true })
const packed = JSON.parse(
	execFileSync(
		`npm`,
		[`pack`, `--json`, `--ignore-scripts`, `--pack-destination`, artifacts],
		{ cwd: directory, encoding: `utf8` },
	),
) as { filename: string }[]
const artifact = path.join(artifacts, `breakage.tgz`)
renameSync(path.join(artifacts, packed[0]!.filename), artifact)
execFileSync(process.execPath, [`src/breakage.x.ts`, `npm`, `check`], {
	cwd: directory,
	stdio: `inherit`,
})

const consumer = mkdtempSync(path.join(tmpdir(), `breakage-core-consumer-`))
try {
	cpSync(path.join(directory, `tests/peers/core`), consumer, {
		recursive: true,
	})
	execFileSync(
		`npm`,
		[
			`install`,
			artifact,
			`--ignore-scripts`,
			`--legacy-peer-deps`,
			`--no-audit`,
			`--no-fund`,
		],
		{ cwd: consumer, stdio: `inherit`, env: { ...process.env, NODE_PATH: `` } },
	)
	execFileSync(process.execPath, [`check.ts`], {
		cwd: consumer,
		stdio: `inherit`,
		env: { ...process.env, NODE_PATH: `` },
	})
} finally {
	rmSync(consumer, { recursive: true, force: true })
}
