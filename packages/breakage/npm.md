# npm peer compatibility

Use `breakage npm` to test a packed package against the peer versions you declare. This is an optional npm-specific feature. The ordinary public check and its four adoption conditions remain the same; keep that check required alongside peer compatibility.

Consider an integration with `"atom.io": "^1 || ^2"`. Its current workspace tests may pass against an edited core, even if only the integration will ship. Representative environments let it prove compatibility with actual released versions. An explicitly registered candidate environment can additionally prove conditional compatibility with a core release your release plan certifies.

The npm commands require Node 22.18 or newer (including native erasable TypeScript for `.ts` configuration), Git, and your installation/test tools. They run on the filesystem, inside complete representative directories. They do not publish packages.

## Declare support deliberately

Current candidates must declare explicit peer support eras, for example `"atom.io": "^0.53.3 || ^0.54.0"`. Moving workspace shorthand (`workspace:`, `workspace:*`, `workspace:^`, and `workspace:~`) is rejected, including in coordinated peer candidates. With `workspace:^`, advancing the local core from `0.53.3` to `0.54.0` silently changes the published support range and drops the previous era. Keep that decision explicit and test the versions you promise to support.

A fixed declaration such as `workspace:^0.53.3` is accepted and compared as `^0.53.3`, matching its packed form. Ordinary semver ranges and optional peers retain their meaning. Workspace aliases and relative paths are unsupported. Current source manifests are never rewritten by this normalization.

Older releases may have used moving shorthand. For the baseline comparison, register that peer's directory in `localPeers`; Breakage reads its version from the same historical commit as the integration manifest. For example, historical `workspace:^` becomes `^0.53.3` when that commit's peer version is `0.53.3`, even if today's checkout or release plan says `0.54.0`. Missing historical evidence is a setup error. The configured directory must exist at the baseline commit; automatic tracking across package moves is unsupported.

After removing a peer requirement, you may retain its historical registration even if its directory has been deleted from the current checkout. Breakage still checks existing registered directories for workspace-source leaks. A broken directory link remains an error.

## Start with released peers

In the integration package, create complete environments for the peer formulations you want to exercise. For example, `peer-environments/core-1/package.json`:

```json
{
	"name": "core-1-contracts",
	"version": "1.0.0",
	"private": true,
	"type": "module",
	"dependencies": { "atom.io": "1.12.0", "react": "19.0.0" }
}
```

Choose real published versions appropriate for your package. Install once and commit this directory's manifest and lock file. Add any test runner and helpers it needs to its own development dependencies. Give each additional formulation its own directory and lock file. Every required peer of the integration must be present; several coupled peers share one environment. Include all intended representatives in the glob, including multiple representatives of the same era.

Ignore the disposable execution directories in your repository:

```gitignore
peer-environments/*/test/
node_modules/
artifacts/
```

Build and pack the integration before checking. `npm pack --ignore-scripts --pack-destination artifacts` creates an archive with a versioned filename; configure `artifact` to that file or have your build copy it to a stable path. Breakage checks the installed archive's name, version, and peer declarations against the current manifest. Repository preparation owns making the archive current, including generated files and runtime version constants.

Write current contracts that import the package and its peers by consumer package names. Keep fixtures and explicit runner configuration under the package directory. The command runs in `peer-environments/<name>/test/`, with those selected paths copied intact. Avoid source aliases, workspace-relative imports, and runner configurations that walk back to workspace source. A Node test runner contract might look like:

```ts
import { test } from "node:test"
import { strict as assert } from "node:assert"
import { createIntegration } from "my-integration"
import { createStore } from "atom.io"

test("the integration uses a consumer's store", () => {
	const store = createStore()
	const integration = createIntegration(store)
	assert.equal(integration.store, store)
})
```

Use your actual public API and meaningful assertions. A suite must fail when no tests execute. Exit 1 denotes assertions failing; other nonzero exits denote setup failure. If your runner reports infrastructure errors as 1 too, wrap it to distinguish setup from assertions. Breakage separately classifies failures in preparation, artifact installation, coverage, and resolution as setup failures.

Create `breakage.config.ts`:

```ts
import type { NpmConfig } from "breakage"

export default {
	npm: {
		artifact: "artifacts/integration.tgz",
		representatives: "peer-environments/*",
		lockfile: "package-lock.json",
		prepareCommand: "npm ci --ignore-scripts --workspaces=false",
		suites: {
			"atom.io": {
				files: ["contracts/core/**/*.ts", "fixtures/**/*"],
				command: "node --test contracts/core/*.test.ts",
			},
		},
		localPeers: {
			"atom.io": {
				directory: "../atom.io",
				artifact: "../atom.io/artifacts/core.tgz",
			},
		},
		baseline: { tagPattern: "refs/tags/my-integration@" },
	} satisfies NpmConfig,
}
```

Every file glob must select at least one regular file. Remove the fixture glob if you have no fixtures. `packageDirectory` defaults to the config file's directory; all npm paths resolve from that package directory. Glob discovery uses paths as labels and installed versions as evidence. Register local peer directories in `localPeers`; each declared local peer must have a suite, and its certified upcoming releases must be supported and exercised by a coordinated representative. External peer suites are an explicit opt-in. No matrix is inferred from registry metadata.

The previous manifest comes from the newest matching release tag. An existing core `baselineFile` may pin a fetched release. For a package's first publication, explicitly use `baseline: { firstRelease: true }` and remove that exception after publishing; missing baseline evidence never silently passes.

Run the package check or a focused test:

```sh
breakage npm check
breakage npm check --coverage-only
breakage npm test atom.io 1
breakage npm test --representative peer-environments/core-1
breakage npm check --config ./breakage.config.ts --json
```

All matching representatives run. Every explicit `||` era needs coverage. Preview versions cover only an exact preview alternative, not stable ranges or other previews. Released representatives outside declared support warn; excluding a planned local release fails the release check. Focused requests can intentionally explore versions outside declared support. An audit reports declarations and release-policy findings without claiming assertions passed. Exit statuses are 0 for successful requested work, 1 for compatibility or uncertified support failures, and 2 for setup or coverage errors.

## Coordinated releases

Create a separate representative that explicitly names candidate peers. Leave an unpublished peer out of the frozen dependency list:

```json
{
	"name": "core-next-contracts",
	"version": "1.0.0",
	"private": true,
	"type": "module",
	"dependencies": { "react": "19.0.0" },
	"breakage": { "candidates": ["atom.io"] }
}
```

Add a typed `releaseIntent` callback to the npm configuration. This example reads a repository-owned JSON release plan; adapt it to Changesets or your release process. The function receives `packageName`, `packageDirectory`, and `currentVersion`, and may return synchronously or asynchronously:

```ts
import { readFile } from "node:fs/promises"
import type { NpmConfig } from "breakage"

const releaseIntent: NonNullable<NpmConfig["releaseIntent"]> = async ({
	packageName,
}) => {
	const plan = JSON.parse(
		await readFile(new URL("./release-plan.json", import.meta.url), "utf8"),
	)
	const version = plan[packageName]
	return version ? { status: "release", version } : { status: "none" }
}
```

Missing intent blocks that candidate environment. Inspection errors and invalid evidence are setup errors, not absent intent. Intended versions must be exact and at least the current workspace version. The candidate archive may have its workspace version or the intended version. Breakage reports both versions. If they differ, it substitutes the intended version in the installed peer's disposable manifest using a fresh file and atomic replacement, preserving shared cache files, other environments, the archive, and the workspace. Archives already carrying their intended version need no substitution.

That substitution simulates release metadata; it does not rebuild the package or change version constants embedded in executable code. Your build owns those constants. To exercise the final version metadata directly, supply a peer archive already built with the certified intended version.

Both `npm check` and its coverage-only audit inspect each currently declared `localPeers` package's release intent, even if you omitted its candidate environment. A certified intended version must be included in the integration's peer range and covered by a coordinated representative. Missing either fails with exit 2; an installed peer at the same version does not substitute for testing the local candidate. Optional local peers have the same obligation when declared. Hook errors and invalid evidence fail setup. Hooks are evaluated once per package per invocation, and must return that package's own release intent.

For a core still labeled `0.53.3` with a planned `0.54.0` release, an integration declaring only `^0.53.3` fails. Adding `|| ^0.54.0` is recommended when retaining the older era. Admission uses version membership: `0.54.0`, `*`, and other ranges containing that version qualify too. Exact-preview enrollment, coverage of other declared eras, and certification for dropping old support still apply. Your release hook supplies the intended version before a versioning PR is merged; Breakage does not infer it from an open PR.

Candidate results are conditional on publication. They can cover a new era, but cannot excuse an incompatible released version that the integration still advertises. Unreleased local edits with no release intent create no new coordination obligation. Registering a currently declared local peer means the integration must accommodate its planned releases. Registrations retained only for historical resolution do not impose this obligation after the peer declaration is removed. The repository owns publication order.

Every coordinated candidate must also accept the representative's peer versions in its own normalized `peerDependencies`. For example, a candidate declaring `minimatch: ^8` cannot be approved alongside Minimatch 9, even if the integration declares `^9` and its assertions pass. Both full checks and coverage audits reject that conflict before candidate installation with exit 2, identifying the candidate, required range, and observed version. The representative must supply required peers needed only by a coordinated candidate too; these additional identities do not require separate integration suites. Absent optional peers are allowed, but present optional peers must satisfy their ranges. Another coordinated peer contributes its certified intended version; a peer on the integration itself uses the integration's current archive version.

Focused `npm test` commands remain available for exploration before advertising an upcoming version. They warn about coordinated candidates' incompatible peer ranges and still execute, while missing required peers remain setup errors. They check release intent for the selected candidate environments but do not audit every planned local release; require the full check or coverage audit as part of the release gate.

## Removing support

`npm check` compares semantic version sets with the previous release. Narrowing a supported range, adding a new required peer, or making an optional peer required produces an end-of-support finding. Equivalent range rewrites do not. Removing a peer requirement entirely relaxes consumer constraints. Preview support is compared too. Optional-peer absence testing is deferred; making an existing optional peer required is still detected as an installation-contract change.

To accept intentional support changes, provide both release intent for the integration and an explicit breaking-release policy:

```ts
const certifyBreaking: NonNullable<NpmConfig["certifyBreaking"]> = ({
	previousVersion,
	release,
}) =>
	previousVersion.startsWith("0.")
		? release.delta === "minor" || release.delta === "major"
		: release.delta === "major"
```

This callback also receives `changes`, with each peer's previous and current declaration. It must return a boolean; throwing fails setup. Public breakage is still handled by the ordinary public command's certification. Compatibility failures against still-declared peers cannot be certified away.

## Installation, isolation, and recovery

`prepareCommand` runs in each representative and must install from its frozen lock file. For another package manager, set `lockfile` and this command accordingly, keeping the environment independent of workspace package substitution. Breakage requires unchanged manifest/lock bytes and checks direct installed identities. An existing installation that changes peer versions during frozen preparation is reported as stale; rerun after reviewing the updated installation. The configured package manager establishes lock consistency; Breakage does not reimplement its lock format.

Installed peers may come from `dependencies`, `devDependencies`, or `optionalDependencies`. An optional dependency overrides a required dependency of the same name. When present, it supplies peer evidence and runs its selected relationship suite normally. When genuinely absent, it supplies no evidence: a required peer still fails, while an optional peer may be omitted. Broken installed links and missing manifests remain errors. Optional-peer absence coverage is not required.

The ignored `test/` directory is also the ownership lock. An existing directory is rejected without deleting it. Independent environments execute concurrently, while two runs cannot own the same environment. On normal completion or failure, Breakage removes only the stage it created. After a killed process, confirm its commands have stopped, inspect the remaining stage, and remove it before retrying.

The default candidate install runs npm with `--prefix . --workspaces=false --ignore-scripts --legacy-peer-deps --package-lock=false --no-audit --no-fund`. It installs the archive's runtime dependencies without automatically installing peers. `installCommand` may replace this with a repository-specific equivalent operating on the generated consumer manifest. It must leave the candidates physically inside the stage. A native dependency that needs a lifecycle build requires an intentional command override.

Tests, candidate packages, and their runtime dependencies must resolve the same physical configured peer instances. Breakage rejects shadow copies and workspace-source peer links, including links to configured local packages. pnpm-style store links into dependency installations are permitted. These checks establish installed package identity, not registry integrity attestation. Package-manager layout, runner aliases, and module loaders remain relevant: preserve consumer resolution and test your actual runner setup.

## CI and caching

Keep the existing public check as `test:breakage` and add the npm check to that release gate, or use `test:breakage:npm` for a separate required job. Preparation must build and pack every participating candidate. A developer-owned matrix can run one configured representative per job, plus an audit job:

```yaml
jobs:
  npm-audit:
    steps:
      # Checkout, install tools/dependencies, and prepare release evidence first.
      - run: breakage npm check --coverage-only
  npm-contracts:
    strategy:
      fail-fast: false
      matrix:
        representative: [peer-environments/core-1, peer-environments/core-2]
    steps:
      # Checkout, install tools/dependencies, and build/pack candidates first.
      - run: breakage npm test --representative "${{ matrix.representative }}"
```

This is a job excerpt: add your runner, checkout, setup, and working directory. Require the audit, all matrix jobs, and the public check before release. Updating the authored representative list requires updating the required matrix. Breakage neither generates workflows nor aggregates cross-job receipts.

Start uncached. A correct cache key includes candidate/peer archives, suite files, representative manifests and lock files, observed installation identities, configuration and imported helpers, baseline, release-plan inputs, and command/environment/toolchain inputs. Unknown dynamic input means the check stays uncached. There is no new npm prelude or mandatory execution plan.

Programmatic consumers can import `npmCheck`, `npmTest`, `formatNpmReport`, and their exported types from `breakage`. Both check functions return a structured `NpmReport` with `exitCode`, coverage, support findings, and independent representative/suite results; `mode` distinguishes audit from execution.
