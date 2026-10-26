---
"breakage": minor
---

Remove npm.baseline.firstRelease and infer first-release status from a successful lookup of release tags on origin, automatically comparing support after publication. Replace the removed option with a package-specific tagPattern or an empty baseline object; lookup failures remain setup errors.
