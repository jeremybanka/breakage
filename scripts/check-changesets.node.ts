import { execFileSync } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, renameSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL(`..`, import.meta.url))
const core = path.join(root, `packages/breakage`)
const integration = path.join(root, `packages/changesets`)
const artifacts = path.join(root, `artifacts`)
mkdirSync(artifacts, { recursive: true })
function pack(directory: string, name: string): string {
	const packed = JSON.parse(
		execFileSync(
			`npm`,
			[`pack`, `--json`, `--ignore-scripts`, `--pack-destination`, artifacts],
			{ cwd: directory, encoding: `utf8` },
		),
	) as { filename: string }[]
	const artifact = path.join(artifacts, name)
	renameSync(path.join(artifacts, packed[0]!.filename), artifact)
	return artifact
}
const coreArtifact = pack(core, `breakage.tgz`)
const integrationArtifact = pack(integration, `changesets.tgz`)
const env = { ...process.env, NODE_PATH: `` }
const npmFlags = [
	`--ignore-scripts`,
	`--workspaces=false`,
	`--no-audit`,
	`--no-fund`,
]

// These are ordinary dependency environments, not declarations of consumer peers.
for (const environment of [`changesets-3.0.0`, `changesets-3.x`, `consumer`]) {
	const consumer = mkdtempSync(path.join(tmpdir(), `breakage-${environment}-`))
	try {
		cpSync(
			path.join(
				integration,
				environment === `consumer`
					? `tests/consumer`
					: `environments/${environment}`,
			),
			consumer,
			{ recursive: true },
		)
		if (environment !== `consumer`) {
			execFileSync(`npm`, [`ci`, ...npmFlags], {
				cwd: consumer,
				stdio: `inherit`,
				env,
			})
		}
		execFileSync(
			`npm`,
			[
				`install`,
				coreArtifact,
				integrationArtifact,
				...npmFlags,
				...(environment === `consumer` ? [`--omit=dev`] : []),
			],
			{ cwd: consumer, stdio: `inherit`, env },
		)
		cpSync(
			path.join(integration, `tests/contract.ts`),
			path.join(consumer, `contract.ts`),
		)
		cpSync(
			path.join(integration, `tests/breakage.config.ts`),
			path.join(consumer, `breakage.config.ts`),
		)
		cpSync(
			path.join(integration, `tests/fixtures`),
			path.join(consumer, `fixtures`),
			{ recursive: true },
		)
		if (environment === `consumer`) {
			execFileSync(process.execPath, [`smoke.ts`], {
				cwd: consumer,
				stdio: `inherit`,
				env,
			})
			// Add the consumer's CLI only after verifying standalone release planning.
			execFileSync(`npm`, [`install`, `--include=dev`, ...npmFlags], {
				cwd: consumer,
				stdio: `inherit`,
				env,
			})
		}
		execFileSync(process.execPath, [`contract.ts`], {
			cwd: consumer,
			stdio: `inherit`,
			env,
		})
	} finally {
		rmSync(consumer, { recursive: true, force: true })
	}
}

const consumer = mkdtempSync(path.join(tmpdir(), `breakage-core-consumer-`))
try {
	cpSync(path.join(core, `tests/peers/core`), consumer, { recursive: true })
	execFileSync(`npm`, [`install`, coreArtifact, ...npmFlags], {
		cwd: consumer,
		stdio: `inherit`,
		env,
	})
	execFileSync(process.execPath, [`check.ts`], {
		cwd: consumer,
		stdio: `inherit`,
		env,
	})
} finally {
	rmSync(consumer, { recursive: true, force: true })
}
