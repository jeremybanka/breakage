import { readFileSync } from "node:fs"

export function value(): string {
	return (
		JSON.parse(
			readFileSync(new URL(`./value.json`, import.meta.url), `utf8`),
		) as { value: string }
	).value
}
