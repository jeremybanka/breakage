# Repository commands

Run these commands from the repository root with `pnpm run <command>`. `mise.toml` pins Node.js and pnpm and adds the root's `node_modules/.bin` to `PATH`.

| Command            | Contract                                                     |
| ------------------ | ------------------------------------------------------------ |
| `fmt`              | Apply the repository formatting policy.                      |
| `check`            | Run all `check:*` validators.                                |
| `check:fmt`        | Check formatting with dprint.                                |
| `check:vp`         | Run Vite Plus linting and TypeScript checks.                 |
| `check:spelling`   | Check spelling with CSpell.                                  |
| `test`             | Build the package and run all current Bun tests once.        |
| `test:public`      | Run current public consumer contracts against source once.   |
| `test:breakage`    | Replay released public contracts with the pinned supervisor. |
| `test:watch`       | Run all current Bun tests in watch mode.                     |
| `build`            | Run workspace package build scripts when available.          |
| `dev`              | Run workspace package development scripts when available.    |
| `change`           | Author pending release notes for publishable packages.       |
| `release:version`  | Prepare package versions and release metadata.               |
| `release:publish`  | Build and publish packages through Changesets.               |
| `staged`           | Format and check staged files.                               |
| `workflows:update` | Update pinned workflow action references and mise.           |

Vite Plus enables type-aware linting and TypeScript checking. Formatting is handled separately by dprint. Add package-specific checks as needed and include them in `check` and CI.

The `breakage` package builds with tsdown and generates its configuration schemas. `test` and `test:watch` dispatch to package scripts through Vite Plus. The test command builds first for integration tests that exercise the distributable entrypoint, then runs both private integration tests and current public contracts. The watch command covers both suites too. Fixture tests are run only inside their disposable Git repositories. The npm fixtures are complete miniature projects containing source, package manifests, Breakage configuration, contracts, and frozen peer environments. The shared project includes runnable released environments and a candidate template; cases that vary labels or versions clone those environments into an explicitly selected set. Tests copy a project, apply case-specific changes, and build its packages; only temporary artifact paths are materialized during setup. Each project is type-checked with local package mappings, and fixture compilation preserves bare peer imports for consumer resolution. Bun is a development dependency provided by mise; the published CLI runs on Node.js.

`test:public` invokes Bun directly, fails when no tests are selected, and does not run the package build or private tests. `test:breakage` must run from a clean repository with access to origin. It resolves a fresh release baseline on every invocation and runs only the released public command; it does not build or run the current suite first. The [self-check guide](../README.md#checking-breakage-with-breakage) documents the pinned supervisor, restore boundary, and explicit bootstrap exception for the three releases without public contracts.

`workflows:update` reads GitHub tags using Git and requires network access. Pass `--dry-run` to preview updates: `pnpm workflows:update --dry-run`.

Vite Plus upgrades must use the target release's official `vp migrate --no-interactive`; preserve the existing lockfile until that command runs.

The optional [npm peer workflow](../packages/breakage/npm.md) provides `breakage npm check`, `breakage npm check --coverage-only`, `breakage npm test <peer> <range>`, and `breakage npm test --representative <path>`. Release compatibility scripts keep the `test:breakage` name, with `test:breakage:npm` available as a separate required gate. The existing `test:breakage:prelude` remains for historical public checks; the npm workflow has no new prelude. The test suite exercises the built npm CLI and real offline npm packing and frozen installations in disposable repositories.
