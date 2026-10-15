# breakage

A greenfield TypeScript workspace with pnpm, mise, Vite Plus, dprint, spelling checks, Changesets, and Renovate.

## Getting started

```sh
mise trust
mise install
pnpm install --frozen-lockfile
pnpm check
pnpm test
```

Dependency installation configures the Git hooks. The pre-commit hook formats and checks staged files.

Add applications under `apps/` and reusable packages under `packages/`. Both directories start empty. The private root package contains infrastructure only; choose package names and public APIs when adding the first package.

The toolchain versions match `mise.toml` and `package.json`. See [repository commands](docs/commands.md) for the supported commands.

## CI and releases

GitHub Actions runs static checks and tests on pull requests and pushes to `main`.

Changesets is ready for future publishable packages. Run `pnpm change` after adding a package that needs a release. The root remains private.

The release workflow activates when the repository variable `CHANGESETS_APP_CLIENT_ID` is set. Add the GitHub App private key as the repository secret `CHANGESETS_APP_PRIVATE_KEY`, grant the app access to this repository with contents and pull request write permissions, and configure npm trusted publishing for each published package.

The optional Renovate workflow activates when `RENOVATE_APP_CLIENT_ID` is set. Add the matching `RENOVATE_APP_PRIVATE_KEY` secret and grant the app contents, pull requests, issues, and commit statuses write permissions. Its policy keeps Vite Plus upgrades on the official migration path.

## License

[MPL-2.0](LICENSE).
