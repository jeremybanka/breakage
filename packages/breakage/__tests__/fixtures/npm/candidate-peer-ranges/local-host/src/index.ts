import { renderer } from "renderer"

export { renderer }
export const render = (text: string): string => renderer.render(text)
