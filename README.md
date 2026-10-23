# Breakage

Run yesterday’s tests against tomorrow’s release.

Breakage runs the public tests from your latest release against your current implementation to detect breaking changes before you ship them. A shared TypeScript release model acknowledges intentional breaks by comparing intended versions with the released baseline, including before and after Changesets versioning. Legacy certification commands remain supported.

```sh
npx breakage \
  --tagPattern="refs/tags/my-library@" \
  --testPattern="tests/public/**/*" \
  --testCommand="npm run test:public" \
  --certifyCommand="false"
```

See the [package documentation](packages/breakage/README.md) for configuration, consumer contracts, shell completion, and migration from break-check.

For independently released npm packages, the optional [`breakage npm` commands](packages/breakage/npm.md) test current contracts against complete peer environments and check changes in declared support. The [accepted specification](docs/npm-compatibility-spec.md) records the design and release-intent contract.

## Development

```sh
mise trust
mise install
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm build
```

The publishable package lives in `packages/breakage`. The private root contains workspace infrastructure. Vite Plus handles task orchestration and static checks, dprint formats the workspace, and Bun runs the package's integration tests. Dependency installation configures Git hooks. See [repository commands](docs/commands.md).

## Checking breakage with breakage

`pnpm test:public` runs the current consumer contracts against source without building. The contracts import `breakage` through a TypeScript path mapping and exercise the CLI entrypoint selected by the current package script. When moving source files, update those runner settings; the released assertions do not depend on internal source paths. The suite covers compatible and incompatible changes, certification, CLI exit statuses and configuration, baseline replay, and restoration of tests while preserving unrelated files, the Git index, and stashes. Each scenario uses a disposable repository with a local bare origin.

`pnpm test:breakage` uses the exact published `breakage@0.8.2` installed as `breakage-supervisor` to resolve the newest `breakage@` release on origin, pin its commit in `.breakage/baseline.json`, and replay its public contracts against current source. The restore pattern includes the entire `packages/breakage/tests/public/` directory, including fixture and observation code. The candidate runs only inside the contracts' disposable repositories; the public command never invokes the outer compatibility command. Run this from a clean checkout. CI runs all current public and private tests together in the Tests job and released contracts independently in the Breakage job, without caching the compatibility result.

**Baseline bootstrap:** releases 0.8.1, 0.8.2, and 0.8.3 predate these contracts. Only their exact recorded tag/commit pairs may finish with a `BOOTSTRAP ONLY` notice and CI job summary saying historical compatibility was not established. The patch changeset accompanying this suite creates the first release baseline when published. From that release onward, a missing suite fails; missing tags, discovery errors, dirty checkouts, and other inconclusive results also fail. The bootstrap exception is never a compatibility claim. Remove the three-entry allowlist after the first contract-bearing release is published. Certification remains `false`: investigate failures and explicitly configure an intentional-break release-plan check before accepting a breaking change.

The supervisor dependency is deliberately pinned independently of the candidate and excluded from automatic Renovate updates. Review supervisor upgrades separately, retaining the bootstrap policy and validating historical replay and restoration.

## Releases

The first release as `breakage` is **0.8.1**, continuing the version of the last `break-check` release. Its rename and migration notes are recorded directly in the [0.8.1 changelog entry](packages/breakage/CHANGELOG.md#081); there is no pending version bump for this first publication. Subsequent consumer-visible changes use `pnpm change`. Before 1.0.0, use patch changesets for features and fixes and minor changesets for breaking changes.

The release workflow activates when `CHANGESETS_APP_CLIENT_ID` is set. Configure the matching `CHANGESETS_APP_PK_QXHA` secret, grant the app contents and pull request write permissions, and configure npm trusted publishing for `breakage` from this repository. `pnpm release:publish` builds only the publishable `breakage` package before Changesets publishes it.

The optional Renovate workflow uses `RENOVATE_APP_CLIENT_ID` and `RENOVATE_APP_PK_K6TH`. Vite Plus upgrades follow the official migration path.

## History

Breakage was developed as `break-check` in [Wayforge](https://github.com/jeremybanka/wayforge). This repository includes 722 package-history commits dating back to March 2024 and all 52 `break-check@` release tags, followed by the package's move and rename. The original scaffold remains in the ancestry. See the [history guide](docs/history/README.md) for commit mappings and commands to inspect earlier releases.

## License

[MPL-2.0](LICENSE).
