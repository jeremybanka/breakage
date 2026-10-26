# npm peer compatibility

Use `breakage npm` to test a packed package against the peer versions you declare. This is an optional npm-specific feature. The ordinary public check and its four adoption conditions remain the same; keep that check required alongside peer compatibility.

Consider an integration with `"atom.io": "^1 || ^2"`. Its current workspace tests may pass against an edited core, even if only the integration will ship. Representative environments let it prove compatibility with actual released versions. An explicitly registered candidate environment can additionally prove conditional compatibility with a core release your release plan identifies.

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

Pin every dependency in an environment manifest to an exact version: `"host": "1.0.0"` and `"host": "2.1.4"` are valid; `"host": "^1"` and `"host": "^1 || ^2"` are setup errors. This applies to all entries in `dependencies`, `devDependencies`, `optionalDependencies`, and `peerDependencies`, including test runners and helpers. Exact prerelease and build versions are allowed. Ranges, wildcards, tags, aliases, workspace protocols, and file or URL specifiers are rejected before installation. The integration's own `peerDependencies` still express its supported eras with ranges. Enroll coordinated local releases through `breakage.candidates`; their resolved intended versions supply the exact identities, and any accompanying dependency pins must match those versions.

Choose real published versions appropriate for your package. Install once and commit this directory's manifest and lock file. Add any test runner and helpers it needs to its own development dependencies with exact pins. Give each additional formulation its own directory and lock file. Every required peer of the integration must be present; several coupled peers share one environment. Include all intended representatives in the glob, including multiple representatives of the same era.

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

Every file glob must select at least one regular file. Remove the fixture glob if you have no fixtures. `packageDirectory` defaults to the config file's directory; all npm paths resolve from that package directory. Glob discovery uses paths as labels and installed versions as evidence. Register local peer directories in `localPeers`; each declared local peer must have a suite, and its planned upcoming releases must be supported and exercised by a coordinated representative. External peer suites are an explicit opt-in. No matrix is inferred from registry metadata.

The previous manifest comes from the newest matching release tag. An existing core `baselineFile` may pin a fetched release. For a package's first publication, explicitly use `baseline: { firstRelease: true }` and remove that exception after publishing; missing baseline evidence never silently passes.

Run the package check or a focused test:

```sh
breakage npm check
breakage npm check --coverage-only
breakage npm test atom.io 1
breakage npm test --representative peer-environments/core-1
breakage npm check --config ./breakage.config.ts --json
```

All matching representatives run. Every explicit `||` era needs coverage. Preview versions cover only an exact preview alternative, not stable ranges or other previews. Build metadata does not affect range matching, including exact preview selection; installed versions must still match their complete environment pins. Released representatives outside declared support warn; excluding a planned local release fails the release check. Focused requests can intentionally explore versions outside declared support. An audit reports declarations and release-policy findings without claiming assertions passed. Exit statuses are 0 for successful requested work, 1 for compatibility or unapproved support failures, and 2 for setup or coverage errors.

Focused peer/range requests validate manifest pins and skip versions outside the requested range before acquiring stages or preparing dependencies. Coordinated candidates are selected by their resolved intended versions, and exact-preview selection follows the same rules as coverage. Excluded environments need no lockfile or available stage. Disjoint requests for the same peer can run independently in one checkout without parsing lock files. Requests that select the same environment still contend for its stage, including requests for different peers in a coupled environment. Selected installations retain all frozen-input, identity, and compatibility checks.

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

Set `release.resolveDelta` to a synchronous/asynchronous resolver receiving `packageName`, `packageDirectory`, and `currentVersion`. For Changesets, use the optional helper:

```ts
import { changesetsReleaseDelta } from "breakage/changesets"
import { semverPolicy } from "breakage"

const release = {
	resolveDelta: changesetsReleaseDelta(),
	policy: semverPolicy({ beforeV1: "minor" }),
}
```

Assign this object to `npm.release`, or share it at the top level with `defineConfig`. A custom resolver returns `{ previousVersion, version, delta }` or `undefined`; errors must throw. Missing intent blocks that candidate environment. Inspection errors and invalid evidence are setup errors, not absent intent. Both transition versions must be exact, the target must be at least the current workspace version, and the delta must match the versions. Candidate identity uses the transition's `version`; no breaking-change policy is applied to candidate enrollment. The candidate archive may have its workspace version or the intended version. Breakage reports both versions. If they differ, it substitutes the intended version in the installed peer's disposable manifest using a fresh file and atomic replacement, preserving shared cache files, other environments, the archive, and the workspace. Archives already carrying their intended version need no substitution.

That substitution simulates release metadata; it does not rebuild the package or change version constants embedded in executable code. Your build owns those constants. To exercise the final version metadata directly, supply a peer archive already built with the resolved intended version.

Both `npm check` and its coverage-only audit inspect each currently declared `localPeers` package's release intent, even if you omitted its candidate environment. A resolved intended version must be included in the integration's peer range and covered by a coordinated representative. Missing either fails with exit 2; an installed peer at the same version does not substitute for testing the local candidate. Optional local peers have the same obligation when declared. Resolver errors and invalid evidence fail setup. Resolvers are evaluated once per package and baseline context per invocation, and must return that package's own release intent.

For a core still labeled `0.53.3` with a planned `0.54.0` release, an integration declaring only `^0.53.3` fails. Adding `|| ^0.54.0` is recommended when retaining the older era. Admission uses version membership: `0.54.0`, `*`, and other ranges containing that version qualify too. Exact-preview enrollment, coverage of other declared eras, and breaking release evidence for dropping old support still apply. Your delta resolver supplies the intended transition before a versioning PR is merged; Breakage does not infer it from an open PR.

Candidate results are conditional on publication. They can cover a new era, but cannot excuse an incompatible released version that the integration still advertises. Unreleased local edits with no release intent create no new coordination obligation. Registering a currently declared local peer means the integration must accommodate its planned releases. Registrations retained only for historical resolution do not impose this obligation after the peer declaration is removed. The repository owns publication order.

Every coordinated candidate must also accept the representative's peer versions in its own normalized `peerDependencies`. For example, a candidate declaring `minimatch: ^8` cannot be approved alongside Minimatch 9, even if the integration declares `^9` and its assertions pass. Both full checks and coverage audits reject that conflict before candidate installation with exit 2, identifying the candidate, required range, and observed version. The representative must supply required peers needed only by a coordinated candidate too; these additional identities do not require separate integration suites. Absent optional peers are allowed, but present optional peers must satisfy their ranges. Another coordinated peer contributes its resolved intended version; a peer on the integration itself uses the integration's current archive version.

Focused `npm test` commands remain available for exploration before advertising an upcoming version. They warn about coordinated candidates' incompatible peer ranges and still execute, while missing required peers remain setup errors. They check release intent for the selected candidate environments but do not audit every planned local release; require the full check or coverage audit as part of the release gate.

## Shared release configuration

Use `defineConfig` to share a release resolver and policy with public checks:

```ts
import { defineConfig, semverPolicy } from "breakage"
import { changesetsReleaseDelta } from "breakage/changesets"

export default defineConfig({
	testPattern: "tests/public/**/*",
	test: "npm run test:public",
	release: {
		resolveDelta: changesetsReleaseDelta(),
		policy: semverPolicy({ beforeV1: "minor" }),
	},
	npm: {
		artifact: "artifacts/integration.tgz",
		representatives: "peer-environments/*",
		lockfile: "package-lock.json",
		prepareCommand: "npm ci --ignore-scripts --workspaces=false",
		suites: {
			"atom.io": {
				files: ["contracts/core/**/*.ts"],
				command: "node --test contracts/core/*.test.ts",
			},
		},
		baseline: { tagPattern: "refs/tags/my-integration@" },
	},
})
```

`defineConfig` inherits the top-level `release` into `npm.release`; an explicit `npm.release` overrides it. Programmatic callers can pass the resulting `config.npm` to `npmCheck` or `npmTest`. Both npm and public CLI commands use the same config loader. npm paths remain relative to the config file's directory, or to `npm.packageDirectory` resolved from it.

`npm.release.resolveDelta` replaces `releaseIntent` and returns `{ previousVersion, version, delta }` or `undefined`. Resolution is cached per package and baseline context for each npm invocation. Support checks supply `baseline: { version }` from the integration's historical manifest; Breakage rejects a transition whose `previousVersion` disagrees with that baseline. Local-peer candidate checks have no historical baseline and use the transition's target version for candidate identity and coordination obligations. `changesetsReleaseDelta()` is a factory that returns the resolver, comparing the supplied baseline (or current manifest) with the planned version before Changesets versioning and the manifest version afterward. Because the manifest fallback also supplies a target for an unchanged registered local peer, using it opts those peers into candidate coverage too. A custom resolver can return `undefined` for packages that should have no local release intent. See the [release configuration guide](README.md#typescript-configuration-and-release-intent) for optional Changesets dependencies and standalone helpers.

`npm.release.policy` replaces `certifyBreaking`. The default requires a major increment; `semverPolicy({ beforeV1: "minor" })` permits pre-1.0 minor increments too. Missing evidence or a compatible version delta leaves a support drop unapproved. Invalid evidence and resolver/policy errors fail setup. Compatibility failures against still-declared peers remain failures even when the integration has a breaking release. The old `releaseIntent` and `certifyBreaking` hooks are removed and fail with migration guidance. Policies must be functions and receive `{ previousVersion, version, delta }`.

`prepareCommand`, `installCommand`, and each suite's `command` are nonempty shell strings. Preparation runs in the representative directory; installation and suites run in its disposable `test/` directory. Breakage captures stdout and stderr for reporting. All nonzero preparation/installation results fail setup; suite exit 1 denotes incompatibility and other nonzero exits denote setup failure. Release-delta resolvers and policies are functions; the optional matrix's archive preparation accepts a command or function.

## Removing support

`npm check` compares semantic version sets with the previous release. Narrowing a supported range, adding a new required peer, or making an optional peer required produces an end-of-support finding. Equivalent range rewrites do not. Removing a peer requirement entirely relaxes consumer constraints. Preview support is compared too. Optional-peer absence testing is deferred; making an existing optional peer required is still detected as an installation-contract change.

The shared `release` model accepts intentional support changes when the integration has a breaking version delta against its previous release. Reports use support status `breaking-release` and include `{ previousVersion, version, delta, breaking }` in `support.release`. Missing intent or a compatible delta leaves support changes unapproved. Resolver or policy exceptions fail setup. Public checks use the same release model; compatibility failures against still-declared peers always remain failures.

## Installation, isolation, and recovery

`prepareCommand` runs in each representative and must install from its frozen lock file. For another package manager, set `lockfile` and this command accordingly, keeping the environment independent of workspace package substitution. Breakage requires unchanged manifest/lock bytes and checks direct installed identities. An existing installation that changes peer versions during frozen preparation is reported as stale; rerun after reviewing the updated installation. The configured package manager establishes lock consistency; Breakage does not reimplement its lock format.

Installed peers may come from `dependencies`, `devDependencies`, or `optionalDependencies`. An optional dependency overrides a required dependency of the same name. When present, it supplies peer evidence and runs its selected relationship suite normally. When genuinely absent, it supplies no evidence: a required peer still fails, while an optional peer may be omitted. Broken installed links and missing manifests remain errors. Optional-peer absence coverage is not required.

A representative must not declare conflicting development and runtime requirements for the same dependency. For example, `dependencies.host: "1.0.0"` together with `devDependencies.host: "2.0.0"` is a setup error before installation. Remove the duplicate or give both declarations the same specifier. The same rule applies when the runtime declaration is optional.

Runtime dependencies must resolve through the representative or its test installation. Explicit package-store links remain supported, including dependencies alongside the linked package in its nearest `node_modules` namespace. Finding a dependency only in an unrelated ancestor installation is a setup error, even if it is optional and would make the assertions pass. Breakage checks this before and after execution.

The ignored `test/` directory is also the ownership lock. An existing directory is rejected without deleting it. Independent environments execute concurrently, while two runs cannot own the same environment. On normal completion or failure, Breakage removes only the stage it created. After a killed process, confirm its commands have stopped, inspect the remaining stage, and remove it before retrying.

The default candidate install runs npm with `--prefix . --workspaces=false --ignore-scripts --legacy-peer-deps --package-lock=false --no-audit --no-fund`. It installs the archive's runtime dependencies without automatically installing peers. `installCommand` may replace this with a repository-specific equivalent operating on the generated consumer manifest. It must leave the candidates physically inside the stage. A native dependency that needs a lifecycle build requires an intentional command override.

Tests, candidate packages, and their runtime dependencies must resolve the same physical configured peer instances. Breakage rejects shadow copies and workspace-source peer links, including links to configured local packages. pnpm-style store links into dependency installations are permitted. These checks establish installed package identity, not registry integrity attestation. Package-manager layout, runner aliases, and module loaders remain relevant: preserve consumer resolution and test your actual runner setup.

## CI and caching

Keep the existing public check as `test:breakage` and add the npm check to that release gate, or use `test:breakage:npm` for a separate required job. For a local package, `npm check` still performs the complete check without a matrix plan. For a repository with several packages or distributed runners, use the optional plan → execute → verify protocol below. CI owns scheduling and artifact transport; Breakage owns discovery, audits, candidate identity, and receipt verification.

### Configure and plan a matrix

Keep each package's existing `npm` configuration, representative manifests/lock files, and contracts. Add this to the root `breakage.config.ts`:

```ts
import { defineConfig } from "breakage"

export default defineConfig({
	npmMatrix: {
		configs: ["packages/*/breakage.config.ts"],
		prepare: "pnpm exec turbo run pack:breakage",
		label: ({ packageName, description, representative }) =>
			`${packageName}: ${description ?? representative}`,
	},
})
```

`configs` is a root-relative glob or list of globs. Only matched configs with an `npm` section participate; a package is discovered once even when patterns overlap. Package names must be unique. Root matrix configuration does not implicitly supply release hooks to package configs: share `release` through a TypeScript module and `defineConfig` as usual. Each required peer needs a relationship suite, each declared era needs coverage, and every selected representative must have executable audited suites. Keep exploratory environments outside the matrix's configured representative globs.

`prepare` runs once after the coverage/support audits. Use your existing build/pack task to create the exact `artifact` paths in the package configs, including registered local peers. It must not alter tracked sources, manifests, lock files, contracts, or release evidence. Tool choice and dependency build order remain yours. Alternatively, provide an async function receiving `{ rootDirectory, archives }`; each deduplicated archive request contains `{ packageName, directory, artifact }`, with both paths relative to the root. Its return value is ignored, and throwing fails planning. `label` is optional and receives package name, representative path, optional manifest description, and audited peers; the default is `packageName: representative`.

Use a clean Git checkout and ignore generated archives, `.breakage/npm-plan/`, `.breakage/receipts/`, and each representative's `test/` directory. Commit the intended source/config changes before planning. All package inputs and configured archive paths must stay within the checkout. The root must be the Git checkout root; the default is the current directory. Planning requires baseline tags or pinned baseline files and the same Changesets/tool dependencies as the package checks. With `changesetsReleaseDelta()`, both pending changesets and versioned manifests supply the existing release evidence; no matrix-specific release script is needed.

```sh
breakage npm plan --config breakage.config.ts --out .breakage/npm-plan
# stdout is one JSON object: {"include":[{"id":"...","label":"...",...}]}
# Copy an id from that output; execute every id before verifying.
breakage npm execute <id> --plan .breakage/npm-plan/plan.json --receipt .breakage/receipts/<id>.json
breakage npm verify --plan .breakage/npm-plan/plan.json --receipts '.breakage/receipts/*.json'
```

`plan` writes `plan.json` and content-addressed archives into the bundle directory, defaulting to `.breakage/npm-plan`. `--root` changes the checkout root for all three commands; config, output, plan, and receipt paths resolve from it. Quoting the receipt glob lets Breakage collect all matching files, including duplicates from different runners. Empty discovery, uncovered eras, unapproved support changes, and preparation failures are errors. A failed re-plan removes the previous `plan.json` in that output directory. After cancellation, discard the incomplete bundle and inspect/remove its `.lock` directory before retrying.

The plan has `formatVersion: 1`, a fresh run identity, source commit, configuration and input fingerprints, release evidence, coverage/support audits, expected environments/suites/peer identities, and archive SHA-256 digests. Its `id` binds the complete payload. Execution consumes the bundled archives directly; workers do not repack or restore archives over workspace outputs. Each receipt has `formatVersion: 1`, `planId`, environment `id`, `exitCode`, and a report or setup error. Environment IDs remain stable for a config/representative path, while plan IDs change on every planning run.

Execution rechecks the source, configuration, representative discovery, contract/manifests/lockfile inputs, release evidence, and archive digests before and after running the shared npm test engine with exactly the planned suites. A representative can contain a peer outside its declared support range while covering another peer; matrix execution omits that unsupported relationship's suite, matching the audit. Full peer identity and configuration validation still apply. Explicit `npm test --representative` exploration continues to run every configured suite whose peer is present. A valid plan produces a failure receipt on ordinary setup or compatibility failure. An invalid/unreadable plan or killed process may produce no receipt; that cannot satisfy verification. Assertions retain exit 1, setup failures exit 2, and successful execution exits 0. Planning and aggregate verification return 0 on success and 2 on any failure.

### Use the same protocol from TypeScript

```ts
import { readFile } from "node:fs/promises"
import { npmPlan, npmMatrix, npmExecute, npmVerify } from "breakage"
import config from "./breakage.config.ts"

const location = { rootDirectory: process.cwd() }
if (!config.npmMatrix) throw new Error("Configure npmMatrix first.")
const plan = await npmPlan(config.npmMatrix, location)
const receipts = []
for (const { id } of npmMatrix(plan).include) {
	receipts.push(await npmExecute(plan, id, location))
}
const result = await npmVerify(plan, receipts, location)
process.exitCode = result.exitCode

// Another runner can load the transported bundle without depending on its old path.
const transportedPlan: unknown = JSON.parse(
	await readFile(".breakage/npm-plan/plan.json", "utf8"),
)
```

The exported types are `NpmMatrixConfig`, `NpmPrepareContext`, `NpmArchiveRequest`, `NpmMatrixLabelContext`, `NpmMatrixLocation`, `NpmPlan`, `NpmReceipt`, and `NpmVerification`. `npmVerify` validates the checkout and bundle as well as receipts. `verifyNpmReceipts(plan, receipts)` provides pure structural/audit/receipt verification for custom orchestrators that independently validate source/config/archive identity. It does not inspect the filesystem. Receipt order and runner-local installed paths do not affect either verifier.

### Distribute the matrix in CI

This GitHub Actions example assumes your existing `./.github/actions/setup` installs pinned Node/package-manager versions and frozen workspace dependencies. Keep the plan bundle and receipts specific to the current workflow run; fetch release history in every checkout. The verify job must require successful planning and execution jobs as well as complete receipts, so cancellation or skipped jobs cannot reuse old success. Keep the ordinary public check required separately.

```yaml
name: Peer compatibility
on: [pull_request]
permissions:
  contents: read
jobs:
  plan:
    runs-on: ubuntu-latest
    outputs:
      matrix: ${{ steps.plan.outputs.matrix }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: ./.github/actions/setup
      - id: plan
        run: |
          matrix=$(pnpm exec breakage npm plan)
          echo "matrix=$matrix" >> "$GITHUB_OUTPUT"
      - uses: actions/upload-artifact@v4
        with:
          name: peer-plan
          path: .breakage/npm-plan/
          include-hidden-files: true
          if-no-files-found: error
  execute:
    needs: plan
    runs-on: ubuntu-latest
    name: ${{ matrix.label }}
    strategy:
      fail-fast: false
      matrix: ${{ fromJSON(needs.plan.outputs.matrix) }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: ./.github/actions/setup
      - uses: actions/download-artifact@v4
        with:
          name: peer-plan
          path: .breakage/npm-plan/
      - env:
          ENVIRONMENT_ID: ${{ matrix.id }}
        run: pnpm exec breakage npm execute "$ENVIRONMENT_ID" --plan .breakage/npm-plan/plan.json --receipt ".breakage/receipts/$ENVIRONMENT_ID.json"
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: peer-receipt-${{ matrix.id }}
          path: .breakage/receipts/
          include-hidden-files: true
          if-no-files-found: error
  verify:
    name: Peer compatibility
    if: always()
    needs: [plan, execute]
    runs-on: ubuntu-latest
    steps:
      - env:
          PLAN_RESULT: ${{ needs.plan.result }}
          EXECUTION_RESULT: ${{ needs.execute.result }}
        run: test "$PLAN_RESULT" = success && test "$EXECUTION_RESULT" = success
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: ./.github/actions/setup
      - uses: actions/download-artifact@v4
        with:
          name: peer-plan
          path: .breakage/npm-plan/
      - uses: actions/download-artifact@v4
        with:
          pattern: peer-receipt-*
          path: .breakage/receipts/
      - run: pnpm exec breakage npm verify --plan .breakage/npm-plan/plan.json --receipts '.breakage/receipts/**/*.json'
```

Keep downloaded receipt artifacts in separate subdirectories: merging them could overwrite duplicate filenames before the verifier sees them. Require the stable aggregate `Peer compatibility` job. Pin action references according to your repository policy. Other CI systems can transport the same JSON and archive bundle, schedule `npmMatrix(plan).include`, and run the same commands.

### Remove repository-specific orchestration

For atom.io-style scripts, replace discovery/coverage commands with `npm plan`, archive collection and copying with its bundle, per-environment wrappers with `npm execute`, and custom receipt validation with `npm verify`. Delete the custom plan/receipt types, hashing, suite enumeration, and aggregate verifier tests once the repository uses the protocol. Keep package configs/shared release helpers, authored peer environments/contracts, the build/pack task, tool setup, and CI artifact transport. No workspace manager, task runner, Changesets versioning, or CI provider is invoked implicitly.

Verification rejects missing, duplicate, unexpected, malformed, stale, failed, or skipped receipts; wrong package/peer identities; audit reports substituted for execution; and missing, duplicate, unexecuted, or failing suites. It validates coverage/support audits as well as executions. The protocol checks consistency within trusted CI, not cryptographic attestation of an untrusted worker: a worker able to fabricate both plans and receipts can fabricate success. Commands, hooks, environment variables, and external services remain repository-owned inputs; use identical toolchains and deterministic hooks across jobs.

Start uncached. A correct cache key includes candidate/peer archives, suite files, representative manifests and lock files, observed installation identities, configuration and imported helpers, baseline, release-plan inputs, and command/environment/toolchain inputs. Unknown dynamic input means the check stays uncached. Do not reuse execution receipts across planning runs. There is no new npm prelude, and the matrix protocol is optional.

Programmatic consumers can import `npmCheck`, `npmTest`, `formatNpmReport`, and their exported types from `breakage`. Both check functions return a structured `NpmReport` with `exitCode`, coverage, support findings, and independent representative/suite results; `mode` distinguishes audit from execution.
