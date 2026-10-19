import { execFileSync } from "node:child_process"
import { globSync, rmSync, symlinkSync } from "node:fs"
import path from "node:path"

// The environments own both dependency selection and the cache used by offline tests.
for (const manifest of globSync(`peer-environments/*/package.json`, {
	cwd: import.meta.dirname,
}).sort()) {
	const directory = path.dirname(manifest)
	console.log(`Preparing Minimatch fixture: ${directory}`)
	execFileSync(
		`npm`,
		[
			`ci`,
			`--ignore-scripts`,
			`--cache`,
			path.join(import.meta.dirname, `.cache`),
			`--no-audit`,
			`--no-fund`,
		],
		{ cwd: path.join(import.meta.dirname, directory), stdio: `inherit` },
	)
}

// Type-check the authored host against its supported environment using normal
// package exports. The test harness excludes this link and all installed trees.
const typeDependencies = new URL(`./node_modules`, import.meta.url)
rmSync(typeDependencies, { force: true })
symlinkSync(
	`peer-environments/minimatch-8/node_modules`,
	typeDependencies,
	`dir`,
)
