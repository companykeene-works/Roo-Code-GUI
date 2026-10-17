import fs from "node:fs"
import path from "node:path"
import ts from "typescript"
function scan(dir) {
	for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
		if (item.name.includes("test") || item.name.includes("mock")) continue
		const file = path.join(dir, item.name)
		if (item.isDirectory()) { scan(file); continue }
		if (!file.endsWith(".tsx")) continue
		const src = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
		function visit(node) {
			let text = ""
			if (ts.isJsxText(node)) text = node.text.trim()
			if (ts.isJsxAttribute(node) && ["title", "placeholder", "aria-label", "label"].includes(node.name.getText()) && node.initializer && ts.isStringLiteral(node.initializer)) text = node.initializer.text
			if (text && /[a-zA-Z]/.test(text) && !/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/.test(text) && text.length > 3) {
				console.log(`${file}:${src.getLineAndCharacterOfPosition(node.pos).line + 1} ${text.replace(/\s+/g, " ")}`)
			}
			ts.forEachChild(node, visit)
		}
		visit(src)
	}
}
scan("webview-ui/src/components")
