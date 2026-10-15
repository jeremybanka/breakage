# Package history

Breakage continues the `break-check` package developed in [Wayforge](https://github.com/jeremybanka/wayforge). The import preserves 722 package-history commits, beginning March 3, 2024, and all 52 `break-check@` release tags from `break-check@0.1.0` through `break-check@0.8.1`.

## What was imported

The package's history was extracted with git-filter-repo v2.47.0 using `--path packages/break-check/ --preserve-commit-hashes`. The source refs were Wayforge's checked-out branch and its `break-check@*` tags. The original branch tip was `bd5127dab5a08d3286ae9c18cef0792cd072c5a9`; the latest release tag's original commit was `39c19f37e2a28b9ff50028bef56065553d1e7965`.

Each retained commit has the same package files, author, committer, timestamps, and message as its original Wayforge commit. Filtering changes commit IDs and omits commits that become empty after selecting the package. The historical tag names, tag types, tagger identities, timestamps, annotations, and package contents are preserved. Every imported release tag is an ancestor of the new main branch.

The import was merged with the existing Breakage infrastructure scaffold. Historical files retain their `packages/break-check/` paths and names; the following migration commit moves them to `packages/breakage/` and renames the package. Historical releases still reference Wayforge's shared tooling and workspace dependencies, so inspecting an old tag here does not provide a standalone build environment. The original Wayforge repository retains those complete workspaces.

## Trace an original commit

[commit-map.tsv](commit-map.tsv) maps each retained original Wayforge commit ID to its imported Breakage commit ID. [tag-map.tsv](tag-map.tsv) records the original and imported tag object and commit IDs for every historical release. These files are provenance records; no Git replacement refs are required.

Historical changelog hashes and pull request numbers continue to identify their original Wayforge commits and pull requests. Look up a full or abbreviated original hash in the first column of `commit-map.tsv` to find its imported counterpart. For a commit omitted by filtering, use its original Wayforge commit link.

## Inspect the history

```sh
# Follow the implementation through the move and rename.
git log --follow -- packages/breakage/src/breakage.ts

# Inspect a historical package release at its original path.
git show break-check@0.8.1:packages/break-check/package.json

# Inspect the package tree from the first release.
git ls-tree -r break-check@0.1.0 -- packages/break-check

# List the preserved release tags in version order.
git tag --list 'break-check@*' --sort=version:refname
```

## Release continuity

The first publication as `breakage` retains version **0.8.1**. Its rename and migration notes are in the package's 0.8.1 changelog entry, without a pending bump. Imported tags keep their `break-check@` names; publishing Breakage creates its own `breakage@0.8.1` tag. Future releases follow the normal Changesets workflow.
