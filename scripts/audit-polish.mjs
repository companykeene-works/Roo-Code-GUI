import fs from "node:fs"
function flat(x, p = "", o = {}) {
	for (const [k, v] of Object.entries(x)) {
		const key = p ? `${p}.${k}` : k
		if (typeof v === "string") o[key] = v
		else if (v && typeof v === "object") flat(v, key, o)
	}
	return o
}
let failures = 0
let checked = 0
for (const base of ["webview-ui/src/i18n/locales/", "src/i18n/locales/"]) {
for (const f of fs.readdirSync(base + "en").filter(f => f.endsWith(".json"))) {
	const en = flat(JSON.parse(fs.readFileSync(base + "en/" + f, "utf8")))
	const pl = flat(JSON.parse(fs.readFileSync(base + "pl/" + f, "utf8")))
	const missing = Object.keys(en).filter(k => !(k in pl))
	const params = text => [...text.matchAll(/{{\s*([^}]+?)\s*}}/g)].map(m=>m[1]).sort().join(",")
	const badParams = Object.keys(en).filter(k => k in pl && params(en[k]) !== params(pl[k]))
	failures += missing.length + badParams.length
	checked += Object.keys(en).length
	if(missing.length || badParams.length) console.log(base + f, JSON.stringify({ missing: missing.map(k => [k, en[k]]), badParams }))
}
}
console.log(`${checked} translation keys checked; ${failures} missing keys or mismatched interpolation parameters`)
process.exitCode = failures ? 1 : 0
