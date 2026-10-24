import { writeFileSync } from "node:fs"
writeFileSync(`notes.txt`, `command edit`)
writeFileSync(`artifacts/result.txt`, `command output`)
await import(`./public/contract.ts`)
