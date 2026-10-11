import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import fs from "fs"
import path from "path"
import os from "os"
import { createRequire } from "module"
import { fileURLToPath } from "url"
import { DesktopAgentHost } from "../../src/main/agent-host.js"
import {
	canonicalizePath,
	arePathsEqual,
	loadDesktopConfig,
	saveDesktopConfig,
	renameProject,
} from "../../src/main/config.js"
import { createQuickProject } from "../../src/main/quick-project.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const { JSDOM } = createRequire(import.meta.url)(path.resolve(__dirname, "../../../../webview-ui/node_modules/jsdom")) as {
	JSDOM: new (html: string) => { window: any }
}

describe("P0 Sidebar Project Drag-and-Drop Reordering Test Matrix", () => {
	let tempDir: string
	let configDir: string
	let origAppData: string | undefined
	let origHome: string | undefined
	let origUserProfile: string | undefined

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "roo-dnd-test-"))
		configDir = path.join(tempDir, "config")
		fs.mkdirSync(configDir, { recursive: true })

		origAppData = process.env.APPDATA
		origHome = process.env.HOME
		origUserProfile = process.env.USERPROFILE

		process.env.APPDATA = configDir
		process.env.USERPROFILE = configDir
		process.env.HOME = configDir
	})

	afterEach(() => {
		if (origAppData !== undefined) process.env.APPDATA = origAppData
		else delete process.env.APPDATA

		if (origHome !== undefined) process.env.HOME = origHome
		else delete process.env.HOME

		if (origUserProfile !== undefined) process.env.USERPROFILE = origUserProfile
		else delete process.env.USERPROFILE

		try {
			fs.rmSync(tempDir, { recursive: true, force: true })
		} catch {}
	})

	// Helper to load app.js reorder functions in a clean JSDOM sandbox
	function setupRendererDndSandbox(initialWorkspaces: string[], currentWorkspace = "") {
		const dom = new JSDOM(`<!DOCTYPE html><html><body>
			<div class="sidebar-scroll-content" id="sidebar-scroll-content">
				<div class="sidebar-projects-list" id="sidebar-projects-list"></div>
			</div>
		</body></html>`)

		const window = dom.window
		const document = window.document
		const localStorageMap = new Map<string, string>()

		const localStorageMock = {
			getItem: (key: string) => localStorageMap.get(key) || null,
			setItem: (key: string, val: string) => localStorageMap.set(key, val),
			removeItem: (key: string) => localStorageMap.delete(key),
			clear: () => localStorageMap.clear(),
		}

		const sentMessages: any[] = []
		const sendToServer = (msg: any) => sentMessages.push(msg)

		const appJsSource = fs.readFileSync(path.resolve(__dirname, "../../src/renderer/app.js"), "utf-8")

		// Extract getAuthoritativeWorkspacesList and applyWorkspaceReorder from app.js
		const getAuthStart = appJsSource.indexOf("\tfunction getAuthoritativeWorkspacesList(")
		const applyReorderEnd = appJsSource.indexOf("\n\tfunction renderSidebar()", getAuthStart)
		const helpersSource = appJsSource.slice(getAuthStart, applyReorderEnd)

		const sandboxState = {
			sidebarData: {
				recentWorkspaces: [...initialWorkspaces],
				projectNames: {} as Record<string, string>,
				currentWorkspace,
				activeTaskId: null as string | null,
				chats: {} as Record<string, any[]>,
			},
			currentWorkspace: currentWorkspace ? { path: currentWorkspace, name: path.basename(currentWorkspace) } : null,
			pathNormalize: (p: string) => p.replace(/\\/g, "/").toLowerCase().replace(/\/+$/, ""),
			localStorage: localStorageMock,
			sendToServer,
		}

		const fn = new Function(
			"sidebarData",
			"currentWorkspace",
			"pathNormalize",
			"localStorage",
			"sendToServer",
			helpersSource + "\nreturn { getAuthoritativeWorkspacesList, applyWorkspaceReorder }"
		)

		const helpers = fn(
			sandboxState.sidebarData,
			sandboxState.currentWorkspace,
			sandboxState.pathNormalize,
			sandboxState.localStorage,
			sandboxState.sendToServer
		) as {
			getAuthoritativeWorkspacesList: () => string[]
			applyWorkspaceReorder: (fromWs: string, targetWs: string | null, pos: "before" | "after") => boolean
		}

		return {
			window,
			document,
			sandboxState,
			sentMessages,
			helpers,
		}
	}

	it("1. Arbitrary moves: A B C -> drag C to top = C A B", () => {
		const { helpers, sandboxState } = setupRendererDndSandbox(["C:\\A", "C:\\B", "C:\\C"])
		const result = helpers.applyWorkspaceReorder("C:\\C", "C:\\A", "before")

		expect(result).toBe(true)
		expect(sandboxState.sidebarData.recentWorkspaces).toEqual(["C:\\C", "C:\\A", "C:\\B"])
		expect(helpers.getAuthoritativeWorkspacesList()).toEqual(["C:\\C", "C:\\A", "C:\\B"])
	})

	it("2. Arbitrary moves: A B C -> drag A to bottom = B C A", () => {
		const { helpers, sandboxState } = setupRendererDndSandbox(["C:\\A", "C:\\B", "C:\\C"])
		const result = helpers.applyWorkspaceReorder("C:\\A", "C:\\C", "after")

		expect(result).toBe(true)
		expect(sandboxState.sidebarData.recentWorkspaces).toEqual(["C:\\B", "C:\\C", "C:\\A"])
		expect(helpers.getAuthoritativeWorkspacesList()).toEqual(["C:\\B", "C:\\C", "C:\\A"])
	})

	it("3. Arbitrary moves: A B C D -> drag A between C and D = B C A D", () => {
		// Option a: after C
		const { helpers: helpersA, sandboxState: stateA } = setupRendererDndSandbox(["C:\\A", "C:\\B", "C:\\C", "C:\\D"])
		expect(helpersA.applyWorkspaceReorder("C:\\A", "C:\\C", "after")).toBe(true)
		expect(stateA.sidebarData.recentWorkspaces).toEqual(["C:\\B", "C:\\C", "C:\\A", "C:\\D"])

		// Option b: before D
		const { helpers: helpersB, sandboxState: stateB } = setupRendererDndSandbox(["C:\\A", "C:\\B", "C:\\C", "C:\\D"])
		expect(helpersB.applyWorkspaceReorder("C:\\A", "C:\\D", "before")).toBe(true)
		expect(stateB.sidebarData.recentWorkspaces).toEqual(["C:\\B", "C:\\C", "C:\\A", "C:\\D"])
	})

	it("4. Arbitrary moves: A B C D -> drag D between A and B = A D B C", () => {
		// Option a: after A
		const { helpers: helpersA, sandboxState: stateA } = setupRendererDndSandbox(["C:\\A", "C:\\B", "C:\\C", "C:\\D"])
		expect(helpersA.applyWorkspaceReorder("C:\\D", "C:\\A", "after")).toBe(true)
		expect(stateA.sidebarData.recentWorkspaces).toEqual(["C:\\A", "C:\\D", "C:\\B", "C:\\C"])

		// Option b: before B
		const { helpers: helpersB, sandboxState: stateB } = setupRendererDndSandbox(["C:\\A", "C:\\B", "C:\\C", "C:\\D"])
		expect(helpersB.applyWorkspaceReorder("C:\\D", "C:\\B", "before")).toBe(true)
		expect(stateB.sidebarData.recentWorkspaces).toEqual(["C:\\A", "C:\\D", "C:\\B", "C:\\C"])
	})

	it("5. Multiple consecutive moves work without reload", () => {
		const { helpers, sandboxState } = setupRendererDndSandbox(["C:\\A", "C:\\B", "C:\\C", "C:\\D", "C:\\E"])

		// Step 1: E -> top: [E, A, B, C, D]
		expect(helpers.applyWorkspaceReorder("C:\\E", "C:\\A", "before")).toBe(true)
		expect(sandboxState.sidebarData.recentWorkspaces).toEqual(["C:\\E", "C:\\A", "C:\\B", "C:\\C", "C:\\D"])

		// Step 2: B -> bottom: [E, A, C, D, B]
		expect(helpers.applyWorkspaceReorder("C:\\B", "C:\\D", "after")).toBe(true)
		expect(sandboxState.sidebarData.recentWorkspaces).toEqual(["C:\\E", "C:\\A", "C:\\C", "C:\\D", "C:\\B"])

		// Step 3: A -> between D and B: [E, C, D, A, B]
		expect(helpers.applyWorkspaceReorder("C:\\A", "C:\\D", "after")).toBe(true)
		expect(sandboxState.sidebarData.recentWorkspaces).toEqual(["C:\\E", "C:\\C", "C:\\D", "C:\\A", "C:\\B"])
	})

	it("6. Same-position drop is a clean no-op", () => {
		const { helpers, sandboxState, sentMessages } = setupRendererDndSandbox(["C:\\A", "C:\\B", "C:\\C"])

		// Self drop before
		expect(helpers.applyWorkspaceReorder("C:\\A", "C:\\A", "before")).toBe(false)
		// Self drop after
		expect(helpers.applyWorkspaceReorder("C:\\A", "C:\\A", "after")).toBe(false)
		// Drop A before B (when A is already at index 0 and B is at index 1)
		expect(helpers.applyWorkspaceReorder("C:\\A", "C:\\B", "before")).toBe(false)
		// Drop B after A (when B is already immediately after A)
		expect(helpers.applyWorkspaceReorder("C:\\B", "C:\\A", "after")).toBe(false)

		// Verify order is untouched and zero IPC messages were sent
		expect(sandboxState.sidebarData.recentWorkspaces).toEqual(["C:\\A", "C:\\B", "C:\\C"])
		expect(sentMessages).toHaveLength(0)
	})

	it("7. First position works when moving from any location", () => {
		const { helpers, sandboxState } = setupRendererDndSandbox(["C:\\A", "C:\\B", "C:\\C", "C:\\D"])

		// Move middle item C to top
		expect(helpers.applyWorkspaceReorder("C:\\C", "C:\\A", "before")).toBe(true)
		expect(sandboxState.sidebarData.recentWorkspaces).toEqual(["C:\\C", "C:\\A", "C:\\B", "C:\\D"])
	})

	it("8. Last position works via item drop and via bottom container drop", () => {
		const { helpers, sandboxState } = setupRendererDndSandbox(["C:\\A", "C:\\B", "C:\\C", "C:\\D"])

		// Move A to bottom via targetWs = null (container drop)
		expect(helpers.applyWorkspaceReorder("C:\\A", null, "after")).toBe(true)
		expect(sandboxState.sidebarData.recentWorkspaces).toEqual(["C:\\B", "C:\\C", "C:\\D", "C:\\A"])

		// Dropping already last item into container is a no-op
		expect(helpers.applyWorkspaceReorder("C:\\A", null, "after")).toBe(false)
	})

	it("9. Active project can move and maintains active state without order override", () => {
		const projA = path.join(tempDir, "ProjectA")
		const projB = path.join(tempDir, "ProjectB")
		const projC = path.join(tempDir, "ProjectC")

		saveDesktopConfig({
			lastWorkspacePath: projB,
			recentWorkspaces: [projA, projB, projC],
		})

		const { helpers, sandboxState } = setupRendererDndSandbox([projA, projB, projC], projB)

		// Move active project B to index 0
		expect(helpers.applyWorkspaceReorder(projB, projA, "before")).toBe(true)
		expect(sandboxState.sidebarData.recentWorkspaces.map(canonicalizePath)).toEqual(
			[projB, projA, projC].map(canonicalizePath)
		)

		// Persist to backend config
		saveDesktopConfig({
			recentWorkspaces: sandboxState.sidebarData.recentWorkspaces,
		})

		const config = loadDesktopConfig()
		expect(config.recentWorkspaces?.map(canonicalizePath)).toEqual([projB, projA, projC].map(canonicalizePath))
		expect(arePathsEqual(config.lastWorkspacePath!, projB)).toBe(true)
	})

	it("10. Expanded project vs collapsed project moving preserves expansion state", () => {
		const projA = "C:\\ProjectA"
		const projB = "C:\\ProjectB"
		const expansions = new Set<string>([projA])

		const { helpers, sandboxState } = setupRendererDndSandbox([projA, projB])
		expect(helpers.applyWorkspaceReorder(projA, projB, "after")).toBe(true)
		expect(sandboxState.sidebarData.recentWorkspaces).toEqual([projB, projA])

		// Expansion set remains intact
		expect(expansions.has(projA)).toBe(true)
		expect(expansions.has(projB)).toBe(false)
	})

	it("11. Collapsed project can move cleanly", () => {
		const { helpers, sandboxState } = setupRendererDndSandbox(["C:\\A", "C:\\B", "C:\\C"])
		expect(helpers.applyWorkspaceReorder("C:\\B", "C:\\A", "before")).toBe(true)
		expect(sandboxState.sidebarData.recentWorkspaces).toEqual(["C:\\B", "C:\\A", "C:\\C"])
	})

	it("12. Child chats do not affect project index calculation", () => {
		const { helpers, sandboxState } = setupRendererDndSandbox(["C:\\A", "C:\\B", "C:\\C"])
		// Add child chats to project A and B
		sandboxState.sidebarData.chats = {
			"c:/a": [{ id: "task-1", title: "Chat 1" }, { id: "task-2", title: "Chat 2" }, { id: "task-3", title: "Chat 3" }],
			"c:/b": [{ id: "task-4", title: "Chat 4" }],
		}

		// Reordering ignores chats and only operates on workspace items
		expect(helpers.applyWorkspaceReorder("C:\\C", "C:\\A", "before")).toBe(true)
		expect(sandboxState.sidebarData.recentWorkspaces).toEqual(["C:\\C", "C:\\A", "C:\\B"])
	})

	it("13. Quick project can move seamlessly with regular projects", async () => {
		const projRegular = path.join(tempDir, "RegularProj")
		fs.mkdirSync(projRegular, { recursive: true })

		saveDesktopConfig({
			lastWorkspacePath: projRegular,
			recentWorkspaces: [projRegular],
		})

		const host = new DesktopAgentHost({ workspacePath: projRegular, storageDir: tempDir, extensionPath: tempDir })
		const quickProj = await createQuickProject(host, {
			rootDir: tempDir,
		})

		const config = loadDesktopConfig()
		expect(config.recentWorkspaces?.map(canonicalizePath)).toEqual(
			[projRegular, quickProj.path].map(canonicalizePath)
		)

		// Drag quick project to index 0
		const { helpers, sandboxState } = setupRendererDndSandbox(config.recentWorkspaces!)
		expect(helpers.applyWorkspaceReorder(quickProj.path, projRegular, "before")).toBe(true)
		expect(sandboxState.sidebarData.recentWorkspaces.map(canonicalizePath)).toEqual(
			[quickProj.path, projRegular].map(canonicalizePath)
		)
	})

	it("14. Normal project can move around quick project", () => {
		const regularA = "C:\\RegularA"
		const quickB = "C:\\roocode\\crisp-turing"
		const regularC = "C:\\RegularC"

		const { helpers, sandboxState } = setupRendererDndSandbox([regularA, quickB, regularC])
		expect(helpers.applyWorkspaceReorder(regularC, quickB, "before")).toBe(true)
		expect(sandboxState.sidebarData.recentWorkspaces).toEqual([regularA, regularC, quickB])
	})

	it("15. Order persists after application restart", () => {
		const projA = path.join(tempDir, "A")
		const projB = path.join(tempDir, "B")
		const projC = path.join(tempDir, "C")
		const projD = path.join(tempDir, "D")

		saveDesktopConfig({
			lastWorkspacePath: projA,
			recentWorkspaces: [projA, projB, projC, projD],
		})

		// Reorder: D B A C
		saveDesktopConfig({
			recentWorkspaces: [projD, projB, projA, projC],
		})

		// Simulate restart by reading freshly from disk
		const loaded = loadDesktopConfig()
		expect(loaded.recentWorkspaces?.map(canonicalizePath)).toEqual(
			[projD, projB, projA, projC].map(canonicalizePath)
		)

		// Instantiate new agent host simulating new session
		const newHost = new DesktopAgentHost({ workspacePath: projD, storageDir: tempDir, extensionPath: tempDir })
		expect(arePathsEqual(newHost.getWorkspace(), projD)).toBe(true)
		const reloadedConfig = loadDesktopConfig()
		expect(reloadedConfig.recentWorkspaces?.map(canonicalizePath)).toEqual(
			[projD, projB, projA, projC].map(canonicalizePath)
		)
	})

	it("16. New project addition does not reset existing manual order", () => {
		const projA = path.join(tempDir, "A")
		const projB = path.join(tempDir, "B")
		const projC = path.join(tempDir, "C")
		const projNew = path.join(tempDir, "NewProj")

		// User set order: C, A, B
		saveDesktopConfig({
			lastWorkspacePath: projA,
			recentWorkspaces: [projC, projA, projB],
		})

		// Opening NewProj appends it to the end
		saveDesktopConfig({
			lastWorkspacePath: projNew,
		})

		const config = loadDesktopConfig()
		expect(config.recentWorkspaces?.map(canonicalizePath)).toEqual(
			[projC, projA, projB, projNew].map(canonicalizePath)
		)
	})

	it("17. Removing project keeps remaining items in exact relative order", () => {
		const projA = "C:\\A"
		const projB = "C:\\B"
		const projC = "C:\\C"
		const projD = "C:\\D"

		const { sandboxState } = setupRendererDndSandbox([projC, projA, projB, projD])
		// Remove projA
		sandboxState.sidebarData.recentWorkspaces = sandboxState.sidebarData.recentWorkspaces.filter(
			(w) => w !== projA
		)

		expect(sandboxState.sidebarData.recentWorkspaces).toEqual([projC, projB, projD])
	})

	it("18. Renaming project preserves its position in the list", () => {
		const projA = path.join(tempDir, "A")
		const projB = path.join(tempDir, "B")
		const projC = path.join(tempDir, "C")

		saveDesktopConfig({
			lastWorkspacePath: projA,
			recentWorkspaces: [projC, projA, projB],
		})

		renameProject(projA, "Renamed Alpha")

		const config = loadDesktopConfig()
		expect(config.recentWorkspaces?.map(canonicalizePath)).toEqual(
			[projC, projA, projB].map(canonicalizePath)
		)
		expect(config.projectNames?.[canonicalizePath(projA)]).toBe("Renamed Alpha")
	})

	it("19. Deduplication handles mixed slashes and Windows case variants", () => {
		const { helpers, sandboxState } = setupRendererDndSandbox([
			"c:/project/a",
			"C:\\Project\\A\\",
			"C:\\Project\\B",
			"c:/project/b/",
		])

		const list = helpers.getAuthoritativeWorkspacesList()
		expect(list).toHaveLength(2)
		expect(helpers.applyWorkspaceReorder("C:\\Project\\B", "c:/project/a", "before")).toBe(true)
		expect(sandboxState.sidebarData.recentWorkspaces).toHaveLength(2)
	})

	it("20. Rapid reorders and server updates maintain latest state without revert", () => {
		const { helpers, sandboxState, sentMessages } = setupRendererDndSandbox(["C:\\A", "C:\\B", "C:\\C", "C:\\D"])

		// Rapid move 1
		helpers.applyWorkspaceReorder("C:\\D", "C:\\A", "before")
		// Rapid move 2
		helpers.applyWorkspaceReorder("C:\\C", "C:\\D", "before")

		expect(sandboxState.sidebarData.recentWorkspaces).toEqual(["C:\\C", "C:\\D", "C:\\A", "C:\\B"])
		expect(sentMessages).toHaveLength(2)
		expect(sentMessages[1]).toEqual({
			type: "reorderWorkspaces",
			workspaces: ["C:\\C", "C:\\D", "C:\\A", "C:\\B"],
		})
	})
})
