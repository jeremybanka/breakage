import { readFileSync } from "node:fs"
export const value: string = JSON.parse(
	readFileSync(new URL(`./value.json`, import.meta.url), `utf8`),
).value
