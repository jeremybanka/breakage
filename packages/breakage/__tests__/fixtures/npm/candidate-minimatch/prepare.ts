import { execFileSync } from "node:child_process"
import { globSync } from "node:fs"
import path from "node:path"

// The environments own both dependency selection and the cache used by offline tests.
for (const manifest of globSync(`peer-environments/*/package.json`, {
	cwd: import.meta.dirname,
}).sort()) {
	const directory = path.dirname(manifest)
	console.log(`Preparing Minimatch fixture: ${directory}`)
	execFileSync(
		`bun`,
		[
			`install`,
			`--frozen-lockfile`,
			`--ignore-scripts`,
			// Populate the cache even when node_modules already contains these packages.
			`--force`,
			`--cache-dir`,
			path.join(import.meta.dirname, `.cache`),
		],
		{ cwd: path.join(import.meta.dirname, directory), stdio: `inherit` },
	)
}
