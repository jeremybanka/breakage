export default class MyClass {
	privateVar = "private"

	publicMethod(): string {
		return "publicMethodOutput"
	}

	privateMethod(): string {
		return this.privateVar
	}
}
