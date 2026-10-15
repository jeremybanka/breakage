import { describe, expect, it } from "bun:test"
import MyClass from "./src.ts"

describe("MyClass Public API Test", () => {
	it("should test publicMethod", () => {
		const obj = new MyClass()
		expect(obj.publicMethod()).toBe("publicMethodOutput")
	})
})
