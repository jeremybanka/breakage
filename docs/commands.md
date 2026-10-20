# Repository commands

Run these commands from the repository root with `pnpm run <command>`. `mise.toml` pins Node.js and pnpm and adds the root's `node_modules/.bin` to `PATH`.

| Command                 | Contract                                                                       |
| ----------------------- | ------------------------------------------------------------------------------ |
| `fmt`                   | Apply the repository formatting policy.                                        |
| `check`                 | Run all `check:*` validators.                                                  |
| `check:fmt`             | Check formatting with dprint.                                                  |
| `check:vp`              | Build workspace packages, then run Vite Plus linting and TypeScript checks.    |
| `check:spelling`        | Check spelling with CSpell.                                                    |
| `test`                  | Build the package and run all current Bun tests once.                          |
| `test:fixtures:prepare` | Install frozen external fixture dependencies and populate their offline cache. |
| `test:shard`            | Build and run a test slice with `--shard=<index>/<total>`.                     |
| `test:public`           | Run current public consumer contracts against source once.                     |
| `test:breakage`         | Replay released public contracts with the pinned supervisor.                   |
| `test:watch`            | Run all current Bun tests in watch mode.                                       |
| `build`                 | Run workspace package build scripts when available.                            |
| `dev`                   | Run workspace package development scripts when available.                      |
| `change`                | Author pending release notes for publishable packages.                         |
| `release:version`       | Prepare package versions and release metadata.                                 |
| `release:publish`       | Build and publish packages through Changesets.                                 |
| `staged`                | Format and check staged files.                                                 |
| `workflows:update`      | Update pinned workflow action references and mise.                             |

Vite Plus enables type-aware linting and TypeScript checking. Formatting is handled separately by dprint. Add package-specific checks as needed and include them in `check` and CI.

`pnpm install` runs `test:fixtures:prepare` through the root `prepare` hook, including in CI's shared setup action. It installs the Minimatch fixture's peer environments from their own registry lock files and prepares a local npm cache for offline test execution. Run `pnpm run test:fixtures:prepare` after editing those manifests or lock files, or after installing with lifecycle scripts disabled. Preparation may use the registry; tests install from the copied cache with `--offline`. Frozen representative directories remain outside the pnpm workspace so their npm lock files remain authoritative. Tests copy neither installed dependency trees nor authoring build outputs.

The `breakage` package builds with tsdown and generates its configuration schemas. `test` and `test:watch` dispatch to package scripts through Vite Plus. The test command builds first for integration tests that exercise the distributable entrypoint, then runs both private integration tests and current public contracts. The watch command covers both suites too. Fixture tests are run only inside their disposable Git repositories. The npm fixtures are complete miniature projects containing source, package manifests, Breakage configuration, contracts, and frozen peer environments. The shared project includes runnable released environments and a candidate template; cases that vary labels or versions clone their project's environments into an explicitly selected set. Tests copy a project, apply case-specific changes, and build its packages; runtime workspace dependencies become local tarball paths only in the disposable copy. Fixture compilation preserves bare peer imports for consumer resolution. Bun is a development dependency provided by mise; the published CLI runs on Node.js.

Current fixture packages are private pnpm workspace members with ordinary package exports and `workspace:*` development dependencies. Their shared Vite Plus task configuration builds upstream packages before each fixture build. `pnpm run check:vp` invokes the root `validate` task, whose `dependsOn: ["build"]` lets Vite Plus schedule the workspace builds before `vp check --no-fmt`. That check validates every project's sources, configuration, and contracts against built declarations. The `tsc` build tasks emit fixture JavaScript and declarations; Vite Plus handles validation without a separate typecheck command. There are no fixture TypeScript path aliases or manually created typechecking links. The workspace's development dependency resolution serves authoring checks; runtime compatibility evidence always comes from each representative's exact pins and frozen installation. Historical source packages remain fixture data rather than duplicate workspace members.

`pnpm run test:shard --shard=2/6` builds the package and runs the second of six deterministic Bun test-file slices. It uses the same private and public test directories as `test`, and new test files enter the partition automatically. Use the same total and checkout for every slice. Each CI shard has its own runner, checkout, dependency installation, and build; files within a shard run sequentially. All six shards continue even if one fails. Release packaging and historical compatibility run in separate jobs. The aggregate `Tests` result requires every shard and packaging to succeed, including when a dependency fails or is skipped; keep this stable result required alongside `Breakage`. The full local `test` command still runs the complete suite.

`test:public` invokes Bun directly, fails when no tests are selected, and does not run the package build or private tests. `test:breakage` must run from a clean repository with access to origin. It resolves a fresh release baseline on every invocation and runs only the released public command; it does not build or run the current suite first. The [self-check guide](../README.md#checking-breakage-with-breakage) documents the pinned supervisor, restore boundary, and explicit bootstrap exception for the three releases without public contracts.

`workflows:update` reads GitHub tags using Git and requires network access. Pass `--dry-run` to preview updates: `pnpm workflows:update --dry-run`.

Vite Plus upgrades must use the target release's official `vp migrate --no-interactive`; preserve the existing lockfile until that command runs.

The optional [npm peer workflow](../packages/breakage/npm.md) provides `breakage npm check`, `breakage npm check --coverage-only`, `breakage npm test <peer> <range>`, and `breakage npm test --representative <path>`. Release compatibility scripts keep the `test:breakage` name, with `test:breakage:npm` available as a separate required gate. The existing `test:breakage:prelude` remains for historical public checks; the npm workflow has no new prelude. The test suite exercises the built npm CLI and real offline npm packing and frozen installations in disposable repositories.
