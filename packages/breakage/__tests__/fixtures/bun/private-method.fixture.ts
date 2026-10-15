import { describe, expect, it } from "bun:test"
import MyClass from "./src.ts"

describe("MyClass Private API Test", () => {
	it("should test privateMethod", () => {
		const obj = new MyClass()
		expect(obj.privateMethod()).toBe("private")
	})
})
