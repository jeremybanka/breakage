import { appendFileSync } from "node:fs"
import path from "node:path"

appendFileSync(
	`../../../.breakage/renderer-runs`,
	`${path.basename(path.dirname(process.cwd()))}\n`,
)
