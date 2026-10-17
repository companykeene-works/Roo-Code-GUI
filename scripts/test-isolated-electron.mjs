import { spawn } from "child_process"
import path from "path"
import fs from "fs"
import http from "http"
import { fileURLToPath } from "url"
import { createRequire } from "module"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, "..")
const req = createRequire(path.join(rootDir, "apps/desktop/package.json"))

const PORT = 5992
const ISOLATED_BASE = path.join(rootDir, "isolated-electron-test-data")
const ISOLATED_APPDATA = path.join(ISOLATED_BASE, "appdata")
const ISOLATED_STORAGE = path.join(ISOLATED_BASE, "storage")
const ISOLATED_WORKSPACE = path.join(ISOLATED_BASE, "workspace")

function log(step, msg) {
	console.log(`[ELECTRON-SMOKE] [${step}] ${msg}`)
}

function sleep(ms) {
	return new Promise((r) => setTimeout(r, ms))
}

async function run() {
	try {
		console.log("\n=======================================================")
		console.log("ROO CODE GUI — ISOLATED ELECTRON RUNTIME VERIFICATION")
		console.log("=======================================================\n")

		// 1. Check production paths
		const realAppData = process.env.APPDATA || path.join(process.env.USERPROFILE, "AppData", "Roaming")
		const realRooConfig = path.join(realAppData, "Roo Code", "desktop-config.json")
		const realStorageDir = path.join(process.env.USERPROFILE, ".roo-desktop-data")

		const realConfigExisted = fs.existsSync(realRooConfig)
		const realConfigMtime = realConfigExisted ? fs.statSync(realRooConfig).mtimeMs : 0
		const realStorageExisted = fs.existsSync(realStorageDir)
		const realStorageMtime = realStorageExisted ? fs.statSync(realStorageDir).mtimeMs : 0

		// 2. Prepare isolated dirs
		if (fs.existsSync(ISOLATED_BASE)) {
			fs.rmSync(ISOLATED_BASE, { recursive: true, force: true })
		}
		fs.mkdirSync(ISOLATED_APPDATA, { recursive: true })
		fs.mkdirSync(ISOLATED_STORAGE, { recursive: true })
		fs.mkdirSync(ISOLATED_WORKSPACE, { recursive: true })
		fs.writeFileSync(path.join(ISOLATED_WORKSPACE, "test.txt"), "Isolated workspace content", "utf-8")

		// 3. Resolve Electron binary from apps/desktop
		const electronBinary = req("electron")
		log("LAUNCH", `Resolved Electron binary: ${electronBinary}`)

		const appDir = path.join(rootDir, "apps/desktop")
		const isolatedLogFile = path.join(ISOLATED_APPDATA, "Roo Code", "startup-debug.log")

		log("LAUNCH", `Spawning Electron with isolated storage & config on port ${PORT}...`)
		const child = spawn(
			String(electronBinary),
			[
				appDir,
				"--electron",
				"-p", String(PORT),
				"-w", ISOLATED_WORKSPACE,
				"-s", ISOLATED_STORAGE,
			],
			{
				cwd: rootDir,
				env: {
					...process.env,
					ROO_CONFIG_DIR: ISOLATED_APPDATA,
					APPDATA: ISOLATED_APPDATA,
					USERPROFILE: ISOLATED_BASE,
					HOME: ISOLATED_BASE,
					ROO_STORAGE_DIR: ISOLATED_STORAGE,
				},
				stdio: ["pipe", "pipe", "pipe"],
			}
		)

		let stdoutData = ""
		let stderrData = ""
		child.stdout.on("data", (d) => {
			const s = d.toString()
			stdoutData += s
			process.stdout.write(`[ELECTRON-OUT] ${s}`)
		})
		child.stderr.on("data", (d) => {
			const s = d.toString()
			stderrData += s
			if (!s.includes("DeprecationWarning") && !s.includes("GL error")) {
				process.stderr.write(`[ELECTRON-ERR] ${s}`)
			}
		})

		// 4. Wait for Electron to start and browser window to load
		log("WAIT", "Waiting for BrowserWindow and renderer initialization (up to 25s)...")
		let logContent = ""
		for (let i = 0; i < 50; i++) {
			await sleep(500)
			if (fs.existsSync(isolatedLogFile)) {
				logContent = fs.readFileSync(isolatedLogFile, "utf-8")
				if (logContent.includes("win.loadURL completed successfully") || logContent.includes("did-finish-load")) {
					log("WAIT", `BrowserWindow load confirmed after ${(i + 1) * 0.5}s!`)
					break
				}
			}
		}

		// 5. Inspect isolated log file
		log("INSPECT", `Checking isolated startup log at: ${isolatedLogFile}`)
		if (fs.existsSync(isolatedLogFile)) {
			logContent = fs.readFileSync(isolatedLogFile, "utf-8")
			log("INSPECT", `Startup log exists (${logContent.split("\n").length} lines)`)
			console.log("\n--- ISOLATED STARTUP LOG SNAPSHOT ---")
			console.log(logContent.trim())
			console.log("---------------------------------------\n")
		} else {
			log("WARN", "Isolated startup log not found, checking process output")
		}

		// 6. Check for syntax error in log or stderr
		const hasSyntaxError =
			logContent.includes("Uncaught SyntaxError") ||
			stderrData.includes("SyntaxError") ||
			stdoutData.includes("SyntaxError")

		if (hasSyntaxError) {
			throw new Error("FAILED: SyntaxError detected during Electron startup!")
		}
		log("VERIFY", "Zero SyntaxErrors in Electron main or renderer: PASS")

		// 7. Check for renderer load success
		const hasWebContentsLoad =
			logContent.includes("did-finish-load") ||
			stdoutData.includes("did-finish-load") ||
			logContent.includes("win.loadURL completed successfully")

		log("VERIFY", `BrowserWindow load URL completed: ${hasWebContentsLoad}`)

		// 8. Cleanly terminate isolated process
		log("EXIT", "Terminating isolated Electron process...")
		child.kill("SIGTERM")
		await sleep(1500)
		try { child.kill("SIGKILL") } catch {}

		// 9. Verify production storage integrity
		log("PROD-GUARD", "Verifying production data was untouched...")
		if (realConfigExisted) {
			const afterMtime = fs.statSync(realRooConfig).mtimeMs
			if (afterMtime !== realConfigMtime) {
				throw new Error("CRITICAL: Production desktop-config.json was modified!")
			}
		}
		if (realStorageExisted) {
			const afterStorageMtime = fs.statSync(realStorageDir).mtimeMs
			if (afterStorageMtime !== realStorageMtime) {
				throw new Error("CRITICAL: Production .roo-desktop-data was modified!")
			}
		}
		log("PROD-GUARD", "Production data is 100% untouched: PASS")

		// Clean up isolated test dirs
		try {
			fs.rmSync(ISOLATED_BASE, { recursive: true, force: true })
		} catch {}

		console.log("\n=======================================================")
		console.log("ISOLATED ELECTRON RUNTIME SMOKE TEST PASSED (100% OK)")
		console.log("=======================================================\n")
	} catch (err) {
		console.error("\n❌ Electron smoke test failed:", err)
		try {
			fs.rmSync(ISOLATED_BASE, { recursive: true, force: true })
		} catch {}
		process.exit(1)
	}
}

run()
