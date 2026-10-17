import fs from "node:fs"
import { createRequire } from "node:module"
const require = createRequire(new URL("../src/package.json", import.meta.url))
const puppeteer = require("puppeteer-core")
const browser = await puppeteer.connect({ browserURL: "http://127.0.0.1:9223", defaultViewport: null })
try {
	const pages = await browser.pages()
	const page = pages.find(p => /^http:\/\/127\.0\.0\.1:\d+\/$/.test(p.url()))
	if (!page) throw new Error("Preview page missing")
	if (process.argv.includes("--close")) { await browser.close(); process.exit(0) }
	await page.screenshot({ path: ".design-qa/home.png" })
	const frames = page.frames()
	for (const f of frames) console.log(JSON.stringify({ url: f.url(), text: (await f.evaluate(() => document.body.innerText)).slice(0,6000) }))
} finally { browser.disconnect() }
