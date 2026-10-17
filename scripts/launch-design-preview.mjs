import fs from "node:fs"
import path from "node:path"
import { spawn } from "node:child_process"
import { createRequire } from "node:module"
const root = process.cwd()
const base = path.join(root, ".design-qa")
for (const folder of ["config", "storage", "workspace", "appdata"])
	fs.mkdirSync(path.join(base, folder), { recursive: true })
fs.writeFileSync(
	path.join(base, "workspace", "README.md"),
	"# Projekt demonstracyjny\n\nŚrodowisko do kontroli interfejsu Roo Code.\n",
)
const require = createRequire(path.join(root, "apps/desktop/package.json"))
const isPackaged = process.argv.includes("--packaged") || process.argv.includes("--portable")
const binary = process.argv.includes("--portable")
	? path.join(root, "apps/desktop/release/Roo-Code-PL-Portable-1.0.0-x64.exe")
	: isPackaged
		? path.join(root, "apps/desktop/release/win-unpacked/Roo Code.exe")
		: require("electron")
const args = [
	...(isPackaged ? ["--electron"] : [path.join(root, "apps/desktop")]),
	"-p",
	"5993",
	"-w",
	path.join(base, "workspace"),
	"-s",
	path.join(base, "storage"),
	"--remote-debugging-port=9223",
	"--disable-background-timer-throttling",
	"--disable-renderer-backgrounding",
	"--disable-backgrounding-occluded-windows",
]
const env = {
	...process.env,
	ROO_CONFIG_DIR: path.join(base, "config"),
	ROO_STORAGE_DIR: path.join(base, "storage"),
	APPDATA: path.join(base, "appdata"),
}
delete env.ELECTRON_RUN_AS_NODE
const log = fs.openSync(path.join(base, "runtime.log"), "w")
const child = spawn(binary, args, { cwd: root, env, stdio: ["ignore", log, log], windowsHide: true, detached: true })
fs.writeFileSync(path.join(base, "pid"), String(child.pid))
child.unref()
console.log(`Preview started (PID ${child.pid}), isolated storage in .design-qa`)
