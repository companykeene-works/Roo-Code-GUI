import { spawn } from "child_process"
import path from "path"
import fs from "fs"
import http from "http"
import { fileURLToPath, pathToFileURL } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, "..")

// Dynamically import ws from desktop
const wsPath = path.join(rootDir, "apps/desktop/node_modules/ws/index.js")
const { WebSocket } = await import(pathToFileURL(wsPath).href)

const PORT_1 = 5888
const PORT_2 = 5889
const ISOLATED_BASE = path.join(rootDir, "isolated-test-data")
const ISOLATED_APPDATA = path.join(ISOLATED_BASE, "appdata")
const ISOLATED_STORAGE = path.join(ISOLATED_BASE, "storage")
const ISOLATED_WORKSPACE = path.join(ISOLATED_BASE, "workspace")

function log(step, msg) {
	console.log(`[SMOKE-TEST] [${step}] ${msg}`)
}

function httpGet(url) {
	return new Promise((resolve, reject) => {
		http.get(url, (res) => {
			let data = ""
			res.on("data", (chunk) => (data += chunk))
			res.on("end", () => resolve({ status: res.statusCode, data, headers: res.headers }))
		}).on("error", reject)
	})
}

function sleep(ms) {
	return new Promise((r) => setTimeout(r, ms))
}

async function waitForServer(port, maxAttempts = 30) {
	for (let i = 0; i < maxAttempts; i++) {
		try {
			const res = await httpGet(`http://127.0.0.1:${port}/api/health`)
			if (res.status === 200) return true
		} catch {
			try {
				const res = await httpGet(`http://127.0.0.1:${port}/`)
				if (res.status === 200) return true
			} catch {}
		}
		await sleep(500)
	}
	throw new Error(`Server failed to start on port ${port} after ${maxAttempts * 0.5}s`)
}

let activeChildren = []

function launchInstance(port) {
	log("LAUNCH", `Starting isolated desktop instance on port ${port}...`)
	const cliPath = path.join(rootDir, "apps/desktop/dist/cli.js")
	const child = spawn(
		process.execPath,
		[
			cliPath,
			"--web",
			"--no-open",
			"-p",
			String(port),
			"-w",
			ISOLATED_WORKSPACE,
			"-s",
			ISOLATED_STORAGE,
		],
		{
			cwd: rootDir,
			env: {
				...process.env,
				ROO_CONFIG_DIR: ISOLATED_APPDATA,
				APPDATA: ISOLATED_APPDATA,
				ROO_STORAGE_DIR: ISOLATED_STORAGE,
			},
			stdio: ["pipe", "pipe", "pipe"],
		}
	)

	activeChildren.push(child)

	child.stdout.on("data", (d) => {
		const s = d.toString().trim()
		if (s) log("RUNTIME", s)
	})

	child.stderr.on("data", (d) => {
		const s = d.toString().trim()
		if (s && !s.includes("DeprecationWarning") && !s.includes("ExperimentalWarning")) {
			log("RUNTIME-ERR", s)
		}
	})

	return child
}

async function run() {
	try {
	console.log("\n=======================================================")
	console.log("ROO CODE GUI — ISOLATED DESKTOP RUNTIME SMOKE TEST")
	console.log("=======================================================\n")

	// Phase 1: Pre-launch Production Baseline Check
	log("CHECK", "Verifying production paths and baseline...")
	const realAppData = process.env.APPDATA || path.join(process.env.USERPROFILE, "AppData", "Roaming")
	const realRooConfig = path.join(realAppData, "Roo Code", "desktop-config.json")
	const realStorageDir = path.join(process.env.USERPROFILE, ".roo-desktop-data")

	const realConfigExisted = fs.existsSync(realRooConfig)
	const realConfigMtime = realConfigExisted ? fs.statSync(realRooConfig).mtimeMs : 0
	log("CHECK", `Real production config exists: ${realConfigExisted} (mtime: ${realConfigMtime})`)

	const realStorageExisted = fs.existsSync(realStorageDir)
	const realStorageMtime = realStorageExisted ? fs.statSync(realStorageDir).mtimeMs : 0
	log("CHECK", `Real .roo-desktop-data exists: ${realStorageExisted} (mtime: ${realStorageMtime})`)

	// Clean isolated test dirs
	if (fs.existsSync(ISOLATED_BASE)) {
		fs.rmSync(ISOLATED_BASE, { recursive: true, force: true })
	}
	fs.mkdirSync(ISOLATED_APPDATA, { recursive: true })
	fs.mkdirSync(ISOLATED_STORAGE, { recursive: true })
	fs.mkdirSync(ISOLATED_WORKSPACE, { recursive: true })
	fs.writeFileSync(path.join(ISOLATED_WORKSPACE, "smoke-test.txt"), "Isolated test file contents", "utf-8")

	// Phase 2: Launch Instance 1
	const child1 = launchInstance(PORT_1)
	await waitForServer(PORT_1)
	log("VERIFY", `Instance 1 is UP on http://127.0.0.1:${PORT_1}`)

	// Phase 3: Verify Isolated Storage Path Usage
	log("STORAGE", "Verifying storage directories...")
	const isolatedGlobalStorage = path.join(ISOLATED_STORAGE, "global-storage")
	if (!fs.existsSync(isolatedGlobalStorage)) {
		throw new Error(`CRITICAL: Isolated global-storage was NOT created under ${ISOLATED_STORAGE}!`)
	}
	log("STORAGE", `Isolated globalStorage confirmed at: ${isolatedGlobalStorage}`)

	// Phase 4: Test HTTP UI Assets
	log("UI-ASSETS", "Testing webview UI asset delivery...")
	const indexRes = await httpGet(`http://127.0.0.1:${PORT_1}/`)
	if (indexRes.status !== 200) throw new Error(`Root / returned status ${indexRes.status}`)
	if (!indexRes.data.includes("nav-chat") && !indexRes.data.includes("tab-chat")) {
		throw new Error("index.html missing chat navigation elements")
	}
	log("UI-ASSETS", "index.html served with chat navigation tabs: OK")

	const stylesRes = await httpGet(`http://127.0.0.1:${PORT_1}/styles.css`)
	if (stylesRes.status !== 200 || !stylesRes.data.includes(".chat-sidebar-controls")) {
		throw new Error("styles.css missing native chat styles")
	}
	log("UI-ASSETS", "styles.css served with dual sidebar styles: OK")

	const appJsRes = await httpGet(`http://127.0.0.1:${PORT_1}/app.js`)
	if (appJsRes.status !== 200 || !appJsRes.data.includes("renderChatSidebar")) {
		throw new Error("app.js missing chat sidebar logic")
	}
	// Parse and validate syntax of served app.js to guarantee no runtime parse crash in browser/Electron
	const vm = await import("vm")
	try {
		new vm.Script(appJsRes.data, { filename: "served-app.js" })
		log("UI-ASSETS", "app.js V8 JavaScript syntax validation passed cleanly: OK")
	} catch (syntaxErr) {
		throw new Error(`CRITICAL: app.js contains syntax error: ${syntaxErr.message}`)
	}
	log("UI-ASSETS", "app.js served with dual sidebar logic: OK")

	// Phase 5: Test REST APIs
	log("REST-API", "Testing REST endpoints...")
	const wsRes = await httpGet(`http://127.0.0.1:${PORT_1}/api/workspace`)
	const wsData = JSON.parse(wsRes.data)
	if (!wsData.path || !wsData.path.includes("isolated-test-data")) {
		throw new Error(`Unexpected workspace path in API: ${wsData.path}`)
	}
	log("REST-API", `Workspace API confirmed isolated workspace: ${wsData.path}`)

	const initPrefsRes = await httpGet(`http://127.0.0.1:${PORT_1}/api/chat-preferences`)
	log("REST-API", `Initial chat-preferences response: ${initPrefsRes.data}`)

	const initSessionsRes = await httpGet(`http://127.0.0.1:${PORT_1}/api/chat-sessions`)
	const initSessions = JSON.parse(initSessionsRes.data)
	const initialCount = Array.isArray(initSessions) ? initSessions.length : (initSessions.sessions?.length || 0)
	log("REST-API", `Initial chat-sessions count: ${initialCount}`)

	// Phase 6: Test WebSocket Protocol
	log("WS-PROTOCOL", "Testing WebSocket communication...")
	const WSClient = globalThis.WebSocket
	const ws = new WSClient(`ws://127.0.0.1:${PORT_1}/ws`)
	await new Promise((resolve, reject) => {
		ws.addEventListener("open", resolve, { once: true })
		ws.addEventListener("error", reject, { once: true })
	})
	log("WS-PROTOCOL", "WebSocket connected successfully.")

	const wsResponses = []
	ws.addEventListener("message", (event) => {
		try {
			const str = typeof event.data === "string" ? event.data : event.data.toString()
			const parsed = JSON.parse(str)
			wsResponses.push(parsed)
			if (parsed.type === "extensionMessage" && parsed.message) {
				wsResponses.push(parsed.message)
				log("WS-RECV", `extensionMessage: ${parsed.message.type || parsed.message.action}`)
			} else {
				log("WS-RECV", `${parsed.type || parsed.action}`)
			}
		} catch {}
	})

	function sendWebviewMessage(actionPayload) {
		ws.send(JSON.stringify({ type: "webviewMessage", message: actionPayload }))
	}

	async function waitForWsAction(action, timeoutMs = 5000) {
		const start = Date.now()
		while (Date.now() - start < timeoutMs) {
			const found = wsResponses.find((r) => r.action === action || r.type === action)
			if (found) return found
			await sleep(50)
		}
		throw new Error(`Timeout waiting for WS response action: ${action}`)
	}

	// Save Chat Preferences
	log("WS-PROTOCOL", "Sending chatSavePreferences (Model: deepseek/deepseek-r1, effort: high)...")
	sendWebviewMessage({
		type: "chatSavePreferences",
		chatPreferences: {
			selectedModel: "deepseek/deepseek-r1",
			reasoningEffort: "high",
			webSearchMode: "auto",
		},
	})
	await waitForWsAction("chatPreferencesData")

	// Verify preferences file written to ISOLATED storage
	const prefFile = path.join(isolatedGlobalStorage, "chat-sessions", "preferences.json")
	if (!fs.existsSync(prefFile)) throw new Error("preferences.json was not written to isolated storage!")
	const savedPrefs = JSON.parse(fs.readFileSync(prefFile, "utf-8"))
	if (savedPrefs.selectedModel !== "deepseek/deepseek-r1" || savedPrefs.reasoningEffort !== "high") {
		throw new Error(`Preferences mismatch: ${JSON.stringify(savedPrefs)}`)
	}
	log("WS-PROTOCOL", `Isolated chat preferences saved on disk: ${JSON.stringify(savedPrefs)}`)

	// Create Chat Session
	log("WS-PROTOCOL", "Creating new chat session...")
	sendWebviewMessage({ type: "chatCreateSession", text: "Isolated Smoke Session" })
	const createMsg = await waitForWsAction("chatSessionData")
	const sessionId = createMsg.chatSession.id
	log("WS-PROTOCOL", `Session created with ID: ${sessionId}`)

	// Save Draft
	log("WS-PROTOCOL", "Saving draft for session...")
	sendWebviewMessage({ type: "chatSaveDraft", chatSessionId: sessionId, chatDraft: "This is a smoke test draft" })
	await sleep(300)

	// Rename Session
	log("WS-PROTOCOL", "Renaming session...")
	sendWebviewMessage({ type: "chatRenameSession", chatSessionId: sessionId, text: "Renamed Smoke Session" })
	await waitForWsAction("chatSessionData")
	log("WS-PROTOCOL", "Session renamed successfully.")

	// Verify session file on disk
	const sessionFile = path.join(isolatedGlobalStorage, "chat-sessions", `${sessionId}.json`)
	if (!fs.existsSync(sessionFile)) throw new Error(`Session file not found at: ${sessionFile}`)
	const sessionOnDisk = JSON.parse(fs.readFileSync(sessionFile, "utf-8"))
	if (sessionOnDisk.title !== "Renamed Smoke Session" || sessionOnDisk.draft !== "This is a smoke test draft") {
		throw new Error(`Session content mismatch on disk: ${JSON.stringify(sessionOnDisk)}`)
	}
	log("WS-PROTOCOL", `Session on disk verified with title and draft: ${sessionOnDisk.title}`)

	// Create and delete a second session
	log("WS-PROTOCOL", "Testing session deletion...")
	sendWebviewMessage({ type: "chatCreateSession", text: "Session To Delete" })
	await sleep(400)
	const s2Msg = wsResponses.filter((r) => r.type === "chatSessionData").pop()
	const s2Id = s2Msg.chatSession.id
	sendWebviewMessage({ type: "chatDeleteSession", chatSessionId: s2Id })
	await waitForWsAction("chatSessionsList")
	log("WS-PROTOCOL", `Session ${s2Id} deleted successfully.`)

	ws.close()
	await sleep(300)

	// Stop Instance 1
	log("LIFECYCLE", "Shutting down Instance 1...")
	child1.kill("SIGTERM")
	await sleep(1500)

	// Phase 7: Restart Persistence Test (Instance 2)
	log("RESTART", "Starting Instance 2 on port 5889 to test persistence from disk...")
	const child2 = launchInstance(PORT_2)
	await waitForServer(PORT_2)
	log("RESTART", `Instance 2 is UP on http://127.0.0.1:${PORT_2}`)

	const restPrefs = await httpGet(`http://127.0.0.1:${PORT_2}/api/chat-preferences`)
	const restoredPrefs = JSON.parse(restPrefs.data)
	if (restoredPrefs.selectedModel !== "deepseek/deepseek-r1" || restoredPrefs.reasoningEffort !== "high") {
		throw new Error(`Restored preferences mismatch after restart: ${restPrefs.data}`)
	}
	log("RESTART", `Chat preferences persisted across restart: ${restPrefs.data}`)

	const restSessions = await httpGet(`http://127.0.0.1:${PORT_2}/api/chat-sessions`)
	const parsedSessions = JSON.parse(restSessions.data)
	const restoredSessions = Array.isArray(parsedSessions) ? parsedSessions : (parsedSessions.sessions || [])
	const foundSession = restoredSessions.find((s) => s.id === sessionId)
	if (!foundSession || foundSession.title !== "Renamed Smoke Session") {
		throw new Error(`Restored sessions missing target session: ${restSessions.data}`)
	}
	log("RESTART", `Chat session persisted across restart: ${foundSession.title} (ID: ${foundSession.id})`)

	// Stop Instance 2
	log("LIFECYCLE", "Shutting down Instance 2...")
	child2.kill("SIGTERM")
	await sleep(1000)

	// Phase 8: Verify Production Integrity
	log("PROD-GUARD", "Checking production Roo Code integrity...")
	if (realConfigExisted) {
		const currentMtime = fs.statSync(realRooConfig).mtimeMs
		if (currentMtime !== realConfigMtime) {
			throw new Error("CRITICAL FAILURE: Production desktop-config.json was modified!")
		}
		log("PROD-GUARD", "Production desktop-config.json was 100% UNTOUCHED.")
	}
	if (realStorageExisted) {
		const currentMtime = fs.statSync(realStorageDir).mtimeMs
		if (currentMtime !== realStorageMtime) {
			throw new Error("CRITICAL FAILURE: Production .roo-desktop-data was modified!")
		}
		log("PROD-GUARD", "Production .roo-desktop-data was 100% UNTOUCHED.")
	}

	console.log("\n=======================================================")
	console.log("ALL SMOKE TEST CHECKS PASSED SUCCESSFULLY (100% GREEN)")
	console.log("=======================================================\n")
	} finally {
		for (const c of activeChildren) {
			try {
				c.kill("SIGTERM")
			} catch {}
		}
	}
}

run().catch((err) => {
	console.error("\n❌ SMOKE TEST FAILED:", err)
	process.exit(1)
})
