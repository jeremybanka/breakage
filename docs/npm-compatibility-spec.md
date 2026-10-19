# Breakage npm compatibility specification

Status: accepted implementation contract, reconciled with the [first decisions](./npm-compatibility-decisions.md), [follow-up decisions](./npm-compatibility-followup-decisions.md), in-place representative execution, and the adoption review decisions on explicit support eras, shared-file isolation, and planned local releases. This replaces the design spiked in [PR 20](https://github.com/jeremybanka/breakage/pull/20).

## Motivation

An atom.io integration and its local core can change together while only the integration is scheduled for release. Passing workspace tests then says nothing about whether consumers can use that integration with the released core. Breakage must test the declared support against explicit released formulations, and distinguish those results from conditional evidence involving certified upcoming releases.

## The agnostic core

The existing four adoption conditions remain: semantic versioning, separate source and tests, Git release tags, and command-line tests. Ordinary `breakage` and `breakage prelude` retain their behavior and JSON configuration. They do not inspect npm manifests, require representatives, or depend on a release-management vendor. TypeScript configuration is additionally supported; an explicit config path wins, otherwise `breakage.config.ts` precedes `breakage.config.json`.

The npm implementation lives behind the central CLI's `npm` namespace. It is package scoped, and does not orchestrate repository releases. A plugin framework is deferred.

## Three different forms of breakage

| Kind                    | Evidence                                                                                           | Resolution                                                                                       |
| ----------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Public breakage         | Released public assertions fail against the candidate.                                             | Restore the contract or explicitly certify a breaking release through the existing public check. |
| Compatibility breakage  | Current relationship assertions fail with a declared representative.                               | Fix compatibility or remove the unsupported versions from the declaration.                       |
| End-of-support breakage | The candidate's declared peer range no longer includes versions supported by the previous release. | Restore support or explicitly certify the package's own breaking release.                        |

Certification never excuses a failure against a still-advertised peer. A successful future peer candidate cannot erase a failed released representative. Public and npm checks are independent commands; repositories make both required. End-of-support comparison uses semantic version sets, not textual differences or the count of `||` alternatives. Removing a peer requirement entirely imposes no new version restriction; adding a peer requirement where none existed restricts consumers and requires certification too. Optional-peer absence testing is deferred; making an existing optional peer required is still detected as an installation-contract change.

## Commands and results

- `breakage npm check` audits coverage and planned local releases, checks changes in declared support against the previous release, and executes every matching configured relationship suite in every representative.
- `breakage npm check --coverage-only` prepares and audits all representatives, planned local releases, and support changes, without installing candidate artifacts or executing assertions. It is not a compatibility pass.
- `breakage npm test <peer> <range>` runs every representative matching that request, including explicitly requested versions outside declared support, with a warning for those versions.
- `breakage npm test --representative <path>` runs the applicable suites in that exact configured representative. The path is relative to the package directory, not a semantic label. No match is an error.
- `--config <path>` selects configuration. `--json` emits the structured report; normal output summarizes the same evidence and includes failed command output.

Focused tests do not claim complete declaration coverage, audit all planned local releases, or perform the release baseline comparison. They retain candidate release-intent and isolation checks for the environments they exercise. A developer-owned CI matrix must require the audit and all relevant focused jobs. There are no cross-job receipts, generated workflows, checked-in plans, or npm prelude.

Exit statuses are 0 for successful requested work (including certified support changes), 1 for compatibility or uncertified support failures, and 2 for setup errors or missing coverage. Independent environments continue after another fails. Reports identify exact versions, conditional releases, warnings, unexecuted suites, failure phase, and whether assertions actually ran.

## Configuration

`breakage.config.ts` exports an object with an `npm` property typed as `NpmConfig`. Existing public options may coexist at the top level. Paths in npm configuration resolve relative to `packageDirectory`, which defaults to the configuration file's directory. Programmatic `npmCheck` and `npmTest` take the same config and a base directory. JSON supports the data-only subset; executable release hooks require TypeScript. Node must support native erasable TypeScript when loading `.ts` configurations.

```ts
import type { NpmConfig } from "breakage"

export default {
	npm: {
		artifact: "artifacts/integration.tgz",
		representatives: "peer-environments/*",
		lockfile: "package-lock.json",
		prepareCommand: "npm ci --ignore-scripts",
		suites: {
			"atom.io": {
				files: ["contracts/atom/**/*", "fixtures/**/*"],
				command: "node --test contracts/atom/*.test.ts",
			},
		},
		localPeers: {
			"atom.io": {
				directory: "../atom.io",
				artifact: "../atom.io/artifacts/core.tgz",
			},
		},
		baseline: { tagPattern: "refs/tags/integration@" },
		releaseIntent: async ({
			packageName,
			packageDirectory,
			currentVersion,
		}) => {
			// Inspect the repository's release plan. Throw if inspection fails.
			return { status: "none" }
		},
	} satisfies NpmConfig,
}
```

Every declared local peer needs a dedicated configured suite. Configured external suites opt into checking external peers too; the tool never discovers registry versions or generates a matrix. Suite files are current package-relative globs including contracts, fixtures, and explicit runner configuration. Each pattern must select files. Stage their relative paths intact; reject source symlinks and reserved paths rather than following them into the checkout. Runner commands must fail if no tests run. Exit 1 means assertions failed; other nonzero exits mean setup failed. Repositories must map runner-specific statuses accordingly and keep source aliases out of staged configuration.

## Explicit support declarations

The package under test and every coordinated peer candidate must author explicit peer support ranges, such as `^0.53.3 || ^0.54.0`. Reject moving workspace shorthand (`workspace:`, `workspace:*`, `workspace:^`, and `workspace:~`) with guidance to declare support eras. A local package version change must not silently change a current candidate's support promise. Ordinary semver ranges retain their meaning; this rule does not require exact version pins. Strip `workspace:` from an explicit semver range such as `workspace:^0.53.3`; this fixed declaration needs no local version lookup. Reject unsupported workspace aliases and relative-path syntax explicitly. Preserve peer optionality.

Use normalized current declarations consistently for validation, representative selection, coverage, support comparison, and archive consistency. Packed candidates must match these declarations, including optionality. Normalization never rewrites source manifests or grants release intent.

Historical baselines may contain moving shorthand. Resolve it using the registered `localPeers` package manifest at the same baseline commit: `workspace:*` and bare `workspace:` become the exact historical version, while `workspace:^` and `workspace:~` retain their respective operators. Require a matching package identity and valid version inside the same release repository. Missing registration, historical files, or supported syntax is a setup failure; never substitute today's workspace version or an intended release version. The configured local directory must identify that peer at the baseline commit. This reconstructs historical declarations only; reconstruction of historical peer artifacts remains deferred.

## Representatives and execution

Representatives are complete directories discovered by a configured glob or list of globs. Each has its own manifest, lockfile, and dependency installation. Its manifest selects the entire coupled formulation. Names carry no version meaning. A representative declares candidate peers explicitly in `package.json` as `"breakage": { "candidates": ["atom.io"] }`.

```text
peer-environments/core-1/
  package.json
  package-lock.json
  node_modules/
  test/                     # gitignored, exclusively owned by this run
    package.json
    contracts/
    fixtures/
    node_modules/
      integration/          # installed packed candidate
```

Run the configured frozen installation command inside the representative. Require a lockfile and reject changed manifest/lockfile bytes. If peers were installed before preparation, reject a change to their observed versions as stale state. Validate direct installed package identities against the manifest; never fall back to the checkout's ancestor dependencies. A frozen command is the package-manager-specific authority for lockfile consistency; configure a genuinely frozen command. This delegates lockfile formats and installation layout to the repository's package manager.

Run commands from the ignored `test/` directory inside that representative. It must not already exist, contain tracked files, or be a symlink. Acquire a per-representative lock before preparing or staging; independent representatives run concurrently. Preserve manifest and lock inputs, the Git index, and unrelated files. Delete only the stage created by this invocation, on success and failure. Interrupted runs leave their stage/lock for explicit recovery after verifying no process is active.

The repository builds and packs candidate archives before invocation. Stage a minimal consumer manifest and install the package archive and any explicitly certified peer archives. The default installation uses npm with lifecycle scripts and automatic peer installation disabled; `installCommand` can supply a repository-specific equivalent. Candidate runtime dependencies are installed, while peer instances come from the representative. Verify installed package names and versions and that tests and candidate packages resolve the same physical peer instances. Reject undeclared workspace-source links and candidate substitutions. Registry integrity attestation and historical Git reconstruction of peers are deferred; report installed identity evidence honestly.

The candidate's archive must carry its current workspace manifest version. A coordinated peer archive may carry its current workspace version or its certified intended version. When these differ, set the installed peer manifest to the intended version by exclusively creating a fresh file beside it and atomically renaming that file over the installed entry. Preserve identity/version and declaration checks before replacement. An installed file may share storage with a package cache or another environment; never rewrite its shared contents. An archive already carrying the intended version requires no replacement. Preserve archives, workspace files, and other links to the original manifest, and report both archive and intended versions.

This metadata substitution is a release-planning simulation, conditional on certified publication. It does not rebuild the artifact or alter version constants embedded in runtime code. The repository's build owns those constants and can supply an archive already carrying the intended version. Keep the observed archive version distinguishable from the simulated installed version.

## Coverage and prereleases

Each explicit `||` alternative in a current peer range is a coverage obligation. Run all matching representatives, and fail if any required alternative has none. A complete representative may satisfy several alternatives and peer suites, but each suite runs once per representative. Released representatives outside declared support warn without supplying coverage. A planned local release outside declared support fails the release check. Explicit focused requests may execute versions outside declared support for investigation.

A prerelease can cover only its exact explicitly declared alternative; it cannot represent a broad stable range or another preview. The same rule applies to focused prerelease requests. Oldest/newest representatives are useful authoring practice, not a minimum. Maintainers and dependency automation own updates; Breakage records exactly what was exercised.

## Release intent and support changes

`releaseIntent({ packageName, packageDirectory, currentVersion })` returns `{ status: "none" }` or `{ status: "release", version: "2.0.0" }`. Exceptions and invalid evidence are setup errors. The intended version must be newer than the current version, or equal when the repository already applied versioning. Candidate representatives require positive evidence for every named local peer. Candidate peers may be omitted from frozen dependencies, so preparation never needs an unpublished registry version. If the representative also declares a constraint for a candidate peer, it must accept the certified version. A candidate may cover a new era, with a result explicitly conditional on publication. Publication order remains repository policy.

Both `npm check` modes inspect release intent for every currently declared peer registered in `localPeers`, including optional peers, even when no candidate representative names it. Verify the registered package identity and inspect each package's release intent once per invocation, sharing evidence and failures with candidate preparation and support certification. A registration retained only for historical baseline resolution creates no current obligation after the peer declaration is removed. A local peer with no release intent creates no new obligation; inspection failures and invalid evidence fail setup.

Every planned local release must fall within the downstream's declared support and have a coordinated representative for that exact intended version with its relationship suite selected. Stable version admission uses semver membership: `^0.54.0` is recommended for that era, while `0.54.0`, `*`, and any other range containing `0.54.0` also satisfy this requirement. The existing exact-preview enrollment rule still applies. A matching installed release does not replace candidate evidence. Missing support or candidate coverage is a setup/coverage failure (exit 2), including during an audit; breaking-release certification cannot waive it. During execution the candidate suite must pass, while an audit records that assertions have not run. Declared support for older eras continues to require its own coverage, and removing old support still requires the package's breaking-release certification.

For example, a local core whose manifest still says `0.53.3` but whose release-intent hook certifies `0.54.0` makes a downstream declaring only `^0.53.3` fail the release check. Declaring `^0.53.3 || ^0.54.0` and providing released and coordinated representatives allows both formulations to be tested. An open versioning PR is not evidence by itself; the repository hook supplies the exact intended version from its release plan. Downstream packages with registered local peers must accommodate their planned releases even when they could independently keep shipping against an older core.

The previous release manifest comes from the latest matching Git release tag, or an existing validated core `baselineFile`. Missing or invalid baseline evidence is an error. A first publication must explicitly declare `baseline: { firstRelease: true }`; no baseline failure silently becomes bootstrap success.

When support narrows, call the package's own release-intent hook and then `certifyBreaking({ previousVersion, release, changes })`. `release` includes the intended version and its semantic release delta relative to the previous release. Only an explicit `true` certifies the end-of-support change. The repository chooses its breaking-release policy, including pre-1.0 minor releases; Breakage does not hardcode “major only.” Inspection failures remain setup errors. Support changes are checked across all declared peers, even when their compatibility suites are not configured.

## Task inputs and deferred work

A task cache must include candidate and peer archives, current suite files and fixtures, representative manifests and lock files, observed installation identities, configuration and imported helpers, release-intent inputs, the previous release baseline, command/environment/toolchain inputs, and any other dynamic inputs. Run uncached when those inputs cannot be enumerated. Do not cache an audit as an executed compatibility result.

Deferred: optional-peer absence cases, registry sampling, solver-generated combinations, suggested ranges, workflow generation, cross-job aggregation, a dedicated npm prelude, and a general plugin system.

## Acceptance scenarios

1. Historical-only users keep their existing CLI, configuration, adoption conditions, and public contracts.
2. A locally passing integration fails against released core when the necessary core change has no certified release.
3. An integration that passes all released formulations can ship independently of unrelated core edits when the local core has no release intent.
4. A certified coordinated candidate covers its exact intended formulation conditionally, without hiding failures of still-supported released peers.
5. All matching representatives execute, coupled formulations stay intact, and missing eras fail.
6. Explicit preview coverage never supplies stable coverage; extra-range focused tests warn and execute.
7. Staged fixtures and installed candidates share the representative's physical peers; shadow peers and workspace-source leaks fail setup.
8. Frozen preparation, candidate installation, and missing runner failures remain distinct from assertion failures, with independent work collected.
9. Removing supported versions requires certified breaking intent; equivalent range rewrites do not. Adding a required peer is also detected.
10. Local per-environment execution cleans only its own ignored stage and rejects concurrent ownership or preexisting user files.
11. A manual CI matrix can audit declarations and run each environment independently without generated state.
12. Current candidates reject moving workspace shorthand, accept fixed support eras, and compare their normalized declarations with packed artifacts; historical shorthand resolves only at its baseline commit.
13. Coordinated version substitution changes only the installed manifest entry, preserving hard links in caches and other environments; archives carrying their intended version need no substitution.
14. A planned local release fails the release check if its intended version is excluded or lacks a coordinated representative, even when released coverage passes; caret, exact, wildcard, and other containing ranges all satisfy version admission.
