# npm fixture projects

Each directory is a miniature consumer project: its package source, manifests, Breakage configuration, contracts, and frozen peer environments live together. Local packages keep their own `package.json` beside `src/`. Alternate source files represent deliberate case-specific changes to the same package.

| Project                 | Behavior                                                                                                                                                        |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `candidate-minimatch`   | A host written for Minimatch 8, with complete Minimatch 8 and 9 environments. The default configuration selects 8; the incompatible case selects 9.             |
| `candidate-peer-ranges` | A coordinated host and integration sharing renderer 18. Cases vary declarations, optionality, prerelease versions, or the integration's direct renderer import. |
| `runtime-dependencies`  | A shared host reached through an optional helper package. Cases make the helper required, remove its manifest, or introduce a shadow peer.                      |
| `coupled-peers`         | A representative containing host 1 and renderer 19, with a contract for each relationship.                                                                      |

The [shared project](../../../tests/public/fixtures/npm) supplies the public consumer contracts, released host environments, and a candidate environment template. It lives inside the public restore boundary so released contracts retain all their inputs. Tests can select new labels and versions by cloning these authored environments.

The [fixture harness](../../../tests/public/npm-fixture.ts) copies a whole project, applies a case's changes, compiles each `src/index.ts` to its manifest's `main`, and packs the packages offline. It preserves bare peer imports. Relative runtime tarball dependencies become absolute paths only in the disposable copy. Frozen lock files remain authored fixture inputs; the Minimatch case repacks the pinned published packages without changing their code or metadata.

Each project has its own TypeScript configuration for editor navigation and package-import checking. The repository's package checks include all of them. Run tests through the repository test commands so fixtures are built and executed only in disposable repositories.
