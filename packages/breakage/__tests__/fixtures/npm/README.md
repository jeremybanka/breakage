# npm fixture projects

Each directory is a miniature consumer project: its package source, manifests, Breakage configuration, contracts, and frozen peer environments live together. Local packages keep their own `package.json` beside `src/`. Alternate source files represent deliberate case-specific changes to the same package.

| Project                 | Behavior                                                                                                                                                        |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `candidate-minimatch`   | A host written for Minimatch 8, with complete Minimatch 8 and 9 environments. The default configuration selects 8; the incompatible case selects 9.             |
| `candidate-peer-ranges` | A coordinated host and integration sharing renderer 18. Cases vary declarations, optionality, prerelease versions, or the integration's direct renderer import. |
| `runtime-dependencies`  | A shared host reached through an optional helper package. Cases make the helper required, remove its manifest, or introduce a shadow peer.                      |
| `coupled-peers`         | A representative containing host 1 and renderer 19, with a contract for each relationship.                                                                      |

The [shared project](../../../tests/public/fixtures/npm) supplies the public consumer contracts, released host environments, and a candidate environment template. It lives inside the public restore boundary so released contracts retain all their inputs. Tests can select new labels and versions by cloning these authored environments.

The [fixture harness](../../../tests/public/npm-fixture.ts) copies a whole project, applies a case's changes, compiles each `src/index.ts` to its manifest's `main`, and packs the local packages offline. It preserves bare peer imports. Relative runtime tarball dependencies become absolute paths only in the disposable copy. Frozen lock files remain authored fixture inputs. Installed `node_modules` trees are excluded from copies so every test establishes its own dependency installation.

The Minimatch environments own their exact published dependency pins and registry lock files. Repository installation runs `pnpm run test:fixtures:prepare` to install these environments and populate the fixture's ignored `.cache/` directory. Disposable copies include that cache and install their frozen dependencies offline; no outer aliases or repacked registry packages supply their dependencies. Rerun preparation after changing an environment or installing with scripts disabled. The fixture's ignored `node_modules` link points to the Minimatch 8 environment for type checking through ordinary package exports; the incompatible Minimatch 9 scenario is intentionally exercised at runtime. These fixed regression environments remain under Renovate's default fixture exclusion.

Each project has its own TypeScript configuration for editor navigation and package-import checking. The repository's package checks include all of them. Run tests through the repository test commands so fixtures are built and executed only in disposable repositories.
