# breakage

Breakage continues break-check's version sequence. Historical source and `break-check@` release tags are included in this repository; see the [history guide](../../docs/history/README.md) for provenance and commit mappings. Historical changelog commit IDs refer to the original [Wayforge](https://github.com/jeremybanka/wayforge) commits.

## 0.9.1

### Patch Changes

- e1fbda9: Add optional npm matrix planning, portable candidate archive bundles, per-environment execution receipts, and aggregate verification through TypeScript APIs and `breakage npm plan`, `execute`, and `verify`, reusing shared release evidence before and after Changesets versioning.

## 0.9.0

### Minor Changes

- e932c07: Replace certification hooks and JSON configuration with TypeScript configuration, function resolveDelta and policy hooks, and shell-string test commands; share release evidence across public and npm checks with beforeV1 and optional Changesets helpers that preserve intent after versioning, return validated version transitions through changesetsReleaseDelta() and apply policy separately, and resolve config paths relative to their files. Use Comline 0.9.3 asynchronous configuration loading, config-only options, and strict schemas to support top-level await, preserve hooks, reject unknown keys, and derive authored config types. Validate the packed Changesets integration in authored peer environments.

### Patch Changes

- e932c07: Clarify how to interpret compatibility results with a README flowchart, explain why normal tests must run alongside breakage and why historical import failures can demonstrate breaking changes, and distinguish preserved compatibility from permission to release a breaking change.

## 0.8.5

### Patch Changes

- e66c8f6: Add an optional npm command family for empirical peer compatibility in complete representative environments, coordinated release-intent evidence and peer-declaration validation, and certified end-of-support changes, with in-place ignored test staging, focused CI commands, structured reports, and TypeScript configuration while preserving the agnostic public check.

## 0.8.4

### Patch Changes

- f6c1c91: Publish public consumer contracts for the API, CLI, baseline replay, and restoration guarantees, and check released contracts against current source with a pinned released supervisor and an explicit initial-baseline bootstrap.

## 0.8.3

### Patch Changes

- 4e63127: Move the break-check migration advice to the end of the README so project fit and usage appear first.

## 0.8.2

### Patch Changes

- 13b5490: Add an uncached `breakage prelude` command and `breakagePrelude` API that resolve and fetch a release into an atomically written, gitignored snapshot. Use `--baseline-file` or `baselineFile` to replay contracts from that exact commit without rediscovering remote tags, allowing task runners to cache compatibility checks while invalidating them for new releases or moved tags. Document Turbo deferred hashing and compatibility replay against the tested package’s source while preserving ordinary checks, certification, and test restoration.

## 0.8.1

### First release as Breakage

Continue break-check as breakage in its own repository, retaining version 0.8.1 for the first release under the new name. Install and run `breakage`, rename the default configuration to `breakage.config.json`, regenerate schemas and shell completions with the new CLI name, and use the `breakage` function with `BreakageOptions` and `BreakageOutcome` for programmatic checks. Configuration keys and check outcomes are unchanged.

### Patch Changes

- 4735adf: Document how to author and review consumer compatibility contracts, preserve historical observation code, and diagnose check failures, with the mondrian.pdf adoption as a case study.

## 0.8.0

### Minor Changes

- f44fd6a: Native Nushell completion for `break-check`, `flightdeck`, `klaxon`, and `varmint` now requires Nushell 0.116.0 or newer, inheriting the updated Comline adapter's minimum version. The adapter uses named completion inputs, removes its positional-input deprecation warning, and preserves delegation to other completion providers.

  Upgrade Nushell before loading the updated native integration. For each CLI you use, rerun `<command> completion install nushell` (or regenerate its `.nu` file with `<command> completion nushell`) and open a new shell. Installed completion files are static copies and are not replaced by a package upgrade alone.
- 2ac9ecf: Upgrade Git operations to simple-git v4 with stricter argument validation and environment filtering. Git subprocesses no longer inherit `GIT_*` variables or other guarded variables such as `SSH_ASKPASS`. Projects using environment-based authentication or Git configuration must move those settings to Git configuration files, SSH configuration, or an SSH agent. Test and certification commands continue to inherit the normal process environment.

### Patch Changes

- Updated dependencies [f44fd6a]
  - comline@0.9.0

## 0.7.3

### Patch Changes

- Updated dependencies [4b479c6]
- Updated dependencies [4b479c6]
- Updated dependencies [4b479c6]
- Updated dependencies [4b479c6]
- Updated dependencies [4b479c6]
- Updated dependencies [4b479c6]
  - comline@0.8.1

## 0.7.2

### Patch Changes

- Updated dependencies [df27495]
  - comline@0.8.0

## 0.7.1

### Patch Changes

- Updated dependencies [a0a19eb]
  - comline@0.7.0

## 0.7.0

### Minor Changes

- 8780241: Use `break-check help` to print usage without loading configuration, requiring check options, running checks, or writing schema files. Help is a dedicated command alongside `schema`.

  Replace `--help` and `-h` with `break-check help`; the help option and configuration field are no longer supported. A configuration file named `help` must be passed with an explicit path such as `./help`.

### Patch Changes

- 2b7f241: Reserve `-v` for verbose output and use `-g` for the release tag pattern, eliminating the collision between the two options. Replace uses of `-v` for a tag pattern with `-g` or the existing `--tagPattern` option.
- 77719d3: Add shell completion and explicit completion installation for break-check, flightdeck, klaxon, and varmint, supporting Bash, Zsh, Fish, Nushell, and Carapace. Completion works without valid application configuration or running application commands. Suggest config files and directory options for break-check and flightdeck, CI as a suggested environment-variable name for varmint clean, and hide singleton options after they have been supplied.

  Accept kebab-case aliases for break-check, flightdeck, and klaxon options while preserving existing option names and configuration keys. Break-check also accepts --pattern as an alias for --testPattern.

  Display warnings on stderr for unknown options and options ignored on the selected command. FlightDeck keeps warnings separate from its JSON log output. Warnings remain advisory and do not change successful command exit codes.
- Updated dependencies [5cb9a6b]
  - comline@0.6.4

## 0.6.40

### Patch Changes

- 8effc34: Run checks for disjoint public test paths in parallel without stashing other packages' changes. Coordinate Git setup and cleanup, recognize test paths owned by active checks, and restore only the tests replaced by each invocation. Preserve the Git index, existing stashes, file permissions, unrelated changes, and command outputs. Reject overlapping checks and protect existing ignored files from being overwritten by release-only tests.

  Recognize conventional `1.2.3` and `v1.2.3` release tags as well as package-prefixed and scoped package tags. Select valid versions using semantic-version precedence and ignore tags that do not contain a supported version.
- Updated dependencies [77add5d]
- Updated dependencies [77add5d]
  - comline@0.6.3

## 0.6.39

### Patch Changes

- Updated dependencies [7ece520]
  - comline@0.6.2

## 0.6.38

### Patch Changes

- Updated dependencies [fcf1e8d]
- Updated dependencies [7b68b5a]
  - comline@0.6.1

## 0.6.37

### Patch Changes

- Updated dependencies [8918771]
  - comline@0.6.0

## 0.6.36

### Patch Changes

- comline@0.5.4

## 0.6.35

### Patch Changes

- comline@0.5.3

## 0.6.34

### Patch Changes

- 7b66e63: License all first-party code and assets under the Mozilla Public License 2.0 and include the license notice in published packages.
- Updated dependencies [7b66e63]
  - comline@0.5.2
  - takua@0.2.3

## 0.6.33

### Patch Changes

- Updated dependencies [b4c93d6]
  - comline@0.5.1

## 0.6.32

### Patch Changes

- Updated dependencies [8f28409]
  - takua@0.2.2

## 0.6.31

### Patch Changes

- Updated dependencies [06c0f4a]
- Updated dependencies [06c0f4a]
  - comline@0.5.0

## 0.6.30

### Patch Changes

- Updated dependencies [523a6bd]
  - comline@0.4.8

## 0.6.29

### Patch Changes

- comline@0.4.7

## 0.6.28

### Patch Changes

- Updated dependencies [7a2d506]
  - comline@0.4.6
  - takua@0.2.1

## 0.6.27

### Patch Changes

- Updated dependencies [882df63]
  - takua@0.2.0

## 0.6.26

### Patch Changes

- comline@0.4.5

## 0.6.25

### Patch Changes

- comline@0.4.4

## 0.6.24

### Patch Changes

- c45a4ce: ✨ Support RegExp syntax for `tagPattern`.

## 0.6.23

### Patch Changes

- Updated dependencies [619f89e]
  - takua@0.1.1

## 0.6.22

### Patch Changes

- 9b8aff4: ✨ Improved appearance of debug logging.
- Updated dependencies [9b8aff4]
  - takua@0.1.0

## 0.6.21

### Patch Changes

- Updated dependencies [93fd532]
  - comline@0.4.3

## 0.6.20

### Patch Changes

- Updated dependencies [c9803fd]
  - comline@0.4.2

## 0.6.19

### Patch Changes

- Updated dependencies [442b401]
  - comline@0.4.1

## 0.6.18

### Patch Changes

- 9aa40f0: 🐛 fix issue where baseDirName wasn't included as an option
- Updated dependencies [9aa40f0]
- Updated dependencies [9aa40f0]
- Updated dependencies [9aa40f0]
  - comline@0.4.0

## 0.6.17

### Patch Changes

- Updated dependencies [3893540]
  - comline@0.3.3

## 0.6.16

### Patch Changes

- f903d0e: ✨ Go-to-definition should now route to source files via source maps now shipped for type declarations.
- Updated dependencies [f903d0e]
  - comline@0.3.2

## 0.6.15

### Patch Changes

- comline@0.3.1

## 0.6.14

### Patch Changes

- cb2596b: ⬆️ Use `zod/v4` (included in `zod@^3.25.0`).
- Updated dependencies [cb2596b]
  - comline@0.3.0

## 0.6.13

### Patch Changes

- 29c48a5: ♻️ Changed build vendor from `tsup` to `tsdown`.
- Updated dependencies [29c48a5]
  - comline@0.2.5

## 0.6.12

### Patch Changes

- Updated dependencies [c8927e5]
  - comline@0.2.4

## 0.6.11

### Patch Changes

- Updated dependencies [c5c9ae1]
  - comline@0.2.3

## 0.6.10

### Patch Changes

- comline@0.2.2

## 0.6.9

### Patch Changes

- comline@0.2.1

## 0.6.8

### Patch Changes

- Updated dependencies [9e9afe4]
- Updated dependencies [9e9afe4]
  - comline@0.2.0

## 0.6.7

### Patch Changes

- comline@0.1.10

## 0.6.6

### Patch Changes

- 2743527: ✨ Add a `--help` page to the CLI.
- Updated dependencies [2743527]
- Updated dependencies [2743527]
- Updated dependencies [2743527]
  - comline@0.1.9

## 0.6.5

### Patch Changes

- 635ef98: 🔧 Add repository declaration to manifest.

## 0.6.4

### Patch Changes

- 05f66ce: ✨ Options are no longer required for schema generation.

## 0.6.3

### Patch Changes

- d8749a8: 💬 The logged output from `break-check`'s CLI is now much easier to read.

## 0.6.2

### Patch Changes

- 5793f4d: 🐛 In previous versions, the executable build artifact was missing. Now it is included under bin/break-check.x.js. The prepacked break-check.schema.json file was also missing and now lives in dist/.

## 0.6.1

### Patch Changes

- bb734ff: ✨ When break check completes, only changes beneath the base directory will be stashed.
- bb734ff: 🐛 Fix bug where break check would hang in the event that breaking changes were found but not certified.

## 0.6.0

### Minor Changes

- 3e64647: 🚀 Break check no longer fetches all tags, leading to major speed improvements for repos with many releases.
- 3e64647: ✨ The `--verbose` flag will print statistical information about performance.

## 0.5.0

### Minor Changes

- 05736f1: 💥 BREAKING CHANGE: break-check now outputs a result in json format. This is the only data released to stdout in the executable.
- 05736f1: 🐛 Fix bug where break check would not exit gracefully when the repo was dirty.
- b30015e: ✨ break-check no longer runs a global checkout, making it possible to run multiple jobs simultaneously.

## 0.4.0

### Minor Changes

- 88d556c: ✨ Run break-check with a `break-check.config.json` file.

## 0.3.0

### Minor Changes

- fe4a79c: 💥 BREAKING CHANGE: break-check now requires a "--certifyCommand" option to be passed. This is a shell command which, when run, determines whether breaking changes have been accounted for.

## 0.2.0

### Minor Changes

- a96a798: ✨ Break check will now return an exit code 2 if no tests can be found matching your supplied testPattern.

### Patch Changes

- a96a798: 🐛 break-check will now return you to your working branch after completing its run, rather than a detached HEAD at that ref.
- a96a798: 🐛 The break-check cli will now exit 100 if required arguments are missing.

## 0.1.0

### Minor Changes

- 82305d4: ✨ Will now fetch all tags before trying to check out the tag for the latest release.
- 82305d4: 🐛 Fix bug where, if you have no tests, the release version would be checked out again.

### Patch Changes

- d949cce: 🐛 Fix issue where break-check could not detect breaking changes, due to a failure to await checking out the last tag's public tests. Now the checkout is awaited.
