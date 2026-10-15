# Breakage

Run yesterday’s tests against tomorrow’s release.

Breakage runs the public tests from your latest release against your current implementation to detect breaking changes before you ship them. A project-defined certification command can acknowledge intentional breaks in your release plan.

```sh
npx breakage \
  --tagPattern="refs/tags/my-library@" \
  --testPattern="tests/public/**/*" \
  --testCommand="npm run test:public" \
  --certifyCommand="false"
```

See the [package documentation](packages/breakage/README.md) for configuration, consumer contracts, shell completion, and migration from break-check.

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

## Releases

The first release as `breakage` is **0.8.1**, continuing the version of the last `break-check` release. Its rename and migration notes are recorded directly in the [0.8.1 changelog entry](packages/breakage/CHANGELOG.md#081); there is no pending version bump for this first publication. Subsequent consumer-visible changes use `pnpm change`. Before 1.0.0, use patch changesets for features and fixes and minor changesets for breaking changes.

The release workflow activates when `CHANGESETS_APP_CLIENT_ID` is set. Configure the matching `CHANGESETS_APP_PK_QXHA` secret, grant the app contents and pull request write permissions, and configure npm trusted publishing for `breakage` from this repository. `pnpm release:publish` builds the package before Changesets publishes it.

The optional Renovate workflow uses `RENOVATE_APP_CLIENT_ID` and `RENOVATE_APP_PK_K6TH`. Vite Plus upgrades follow the official migration path.

## History

Breakage was developed as `break-check` in [Wayforge](https://github.com/jeremybanka/wayforge). This repository includes 722 package-history commits dating back to March 2024 and all 52 `break-check@` release tags, followed by the package's move and rename. The original scaffold remains in the ancestry. See the [history guide](docs/history/README.md) for commit mappings and commands to inspect earlier releases.

## License

[MPL-2.0](LICENSE).
