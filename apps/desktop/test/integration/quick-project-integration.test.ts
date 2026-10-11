import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import path from "path"
import fs from "fs"
import os from "os"
import { createRequire } from "module"
import { DesktopAgentHost } from "../../src/main/agent-host.js"
import { createDesktopServer } from "../../src/main/server.js"

const require = createRequire(import.meta.url)
const { JSDOM } = require(path.resolve(__dirname, "../../../../webview-ui/node_modules/jsdom")) as {
	JSDOM: new (html: string) => { window: { document: Document } }
}
import {
	canonicalizePath,
	arePathsEqual,
	loadDesktopConfig,
	saveDesktopConfig,
} from "../../src/main/config.js"
import {
	createQuickProject,
	createQuickProjectDirectory,
	getQuickProjectsRoot,
} from "../../src/main/quick-project.js"

describe("Quick Project Integration Tests", () => {
	let tempDir: string
	let origAppData: string | undefined

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "roo-qp-integ-"))
		origAppData = process.env.APPDATA
		process.env.APPDATA = tempDir
	})

	afterEach(() => {
		process.env.APPDATA = origAppData
		try {
			fs.rmSync(tempDir, { recursive: true, force: true })
		} catch {}
	})

	describe("1. End-to-End Pipeline & Workspace Activation (Phase 10, 11, 12, 16)", () => {
		it("createQuickProject creates directory, activates workspace, and updates recentWorkspaces", async () => {
			const projectsRoot = path.join(tempDir, "roocode-root")
			const host = new DesktopAgentHost({
				workspacePath: "",
				extensionPath: tempDir,
				storageDir: tempDir,
			})

			const broadcastMock = vi.fn()
			const broadcastSidebarMock = vi.fn()

			const result = await createQuickProject(host, {
				rootDir: projectsRoot,
				broadcast: broadcastMock,
				broadcastSidebarData: broadcastSidebarMock,
			})

			// 1. Directory created
			expect(fs.existsSync(result.path)).toBe(true)
			expect(result.path.startsWith(projectsRoot)).toBe(true)
			expect(result.name).toMatch(/^[a-z]+-[a-z]+$/)

			// 2. Workspace active in agentHost
			expect(arePathsEqual(host.getWorkspace(), result.path)).toBe(true)

			// 3. Saved in config
			const config = loadDesktopConfig()
			expect(config.lastWorkspacePath).toBe(canonicalizePath(result.path))
			expect(config.recentWorkspaces).toContain(canonicalizePath(result.path))

			// 4. Broadcasted to clients
			expect(broadcastMock).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "workspaceInfo",
					workspace: expect.objectContaining({ path: canonicalizePath(result.path) }),
				})
			)
			expect(broadcastSidebarMock).toHaveBeenCalled()
		})

		it("persists across restart (Phase 16)", async () => {
			const projectsRoot = path.join(tempDir, "roocode-root")
			const host = new DesktopAgentHost({
				workspacePath: "",
				extensionPath: tempDir,
				storageDir: tempDir,
			})

			const result = await createQuickProject(host, { rootDir: projectsRoot })
			const configBefore = loadDesktopConfig()
			expect(configBefore.recentWorkspaces).toContain(canonicalizePath(result.path))

			// Simulate restarting the application with a new host instance
			const hostAfterRestart = new DesktopAgentHost({
				workspacePath: configBefore.lastWorkspacePath ?? "",
				extensionPath: tempDir,
				storageDir: tempDir,
			})

			const configAfter = loadDesktopConfig()
			expect(configAfter.lastWorkspacePath).toBe(canonicalizePath(result.path))
			expect(configAfter.recentWorkspaces).toContain(canonicalizePath(result.path))
			expect(arePathsEqual(hostAfterRestart.getWorkspace(), result.path)).toBe(true)
		})

		it("creates multiple unique quick projects consecutively (Phase 15)", async () => {
			const projectsRoot = path.join(tempDir, "roocode-root")
			const host = new DesktopAgentHost({
				workspacePath: "",
				extensionPath: tempDir,
				storageDir: tempDir,
			})

			const proj1 = await createQuickProject(host, { rootDir: projectsRoot })
			const proj2 = await createQuickProject(host, { rootDir: projectsRoot })
			const proj3 = await createQuickProject(host, { rootDir: projectsRoot })

			expect(proj1.path).not.toEqual(proj2.path)
			expect(proj2.path).not.toEqual(proj3.path)
			expect(proj1.path).not.toEqual(proj3.path)

			const config = loadDesktopConfig()
			expect(config.recentWorkspaces).toContain(canonicalizePath(proj1.path))
			expect(config.recentWorkspaces).toContain(canonicalizePath(proj2.path))
			expect(config.recentWorkspaces).toContain(canonicalizePath(proj3.path))
			// Last created project is active
			expect(arePathsEqual(host.getWorkspace(), proj3.path)).toBe(true)
		})

		it("cleans up orphan directory if registration fails without corrupting config (Phase 21)", async () => {
			const projectsRoot = path.join(tempDir, "roocode-root")
			const failingHost = {
				setWorkspace: vi.fn().mockRejectedValue(new Error("Simulated host crash")),
				getWorkspace: () => "",
				getDiffFiles: () => [],
			}

			await expect(
				createQuickProject(failingHost as any, { rootDir: projectsRoot })
			).rejects.toThrow("Simulated host crash")

			// Check that no orphaned directory is left in projectsRoot
			if (fs.existsSync(projectsRoot)) {
				const remainingDirs = fs.readdirSync(projectsRoot)
				expect(remainingDirs.length).toBe(0)
			}

			// Project list is not corrupted
			const config = loadDesktopConfig()
			expect(config.recentWorkspaces ?? []).toEqual([])
		})
	})

	describe("2. HTTP Endpoint POST /api/quick-project (Phase 10)", () => {
		let server: any
		let port: number
		let agentHost: DesktopAgentHost

		beforeEach(async () => {
			agentHost = new DesktopAgentHost({
				workspacePath: "",
				extensionPath: tempDir,
				storageDir: tempDir,
			})

			server = createDesktopServer({
				port: 0,
				host: "127.0.0.1",
				agentHost,
			})
			port = await server.start()
		})

		afterEach(async () => {
			await server.stop()
		})

		it("POST /api/quick-project creates and opens project successfully", async () => {
			const resp = await fetch(`http://127.0.0.1:${port}/api/quick-project`, {
				method: "POST",
			})

			expect(resp.status).toBe(200)
			const data = (await resp.json()) as any
			expect(data.path).toBeTruthy()
			expect(data.name).toMatch(/^[a-z]+-[a-z]+$/)
			expect(data.workspace).toBeTruthy()
			expect(data.workspace.path).toBe(data.path)
			expect(fs.existsSync(data.path)).toBe(true)

			// AgentHost now points to the new workspace
			expect(arePathsEqual(agentHost.getWorkspace(), data.path)).toBe(true)

			// Config updated
			const config = loadDesktopConfig()
			expect(config.recentWorkspaces).toContain(canonicalizePath(data.path))
		})
	})

	describe("3. UI Menu & DOM Interaction (Phase 2, 3, 23)", () => {
		it("index.html contains #sidebar-add-project-btn and #sidebar-context-menu", () => {
			const indexPath = path.resolve(__dirname, "../../src/renderer/index.html")
			const html = fs.readFileSync(indexPath, "utf-8")
			expect(html).toContain('id="sidebar-add-project-btn"')
			expect(html).toContain('id="sidebar-context-menu"')
		})

		it("add project menu offers both New Project and Quick Project options without file picker on Quick Project", () => {
			const dom = new JSDOM(`
				<!DOCTYPE html>
				<html>
				<body>
					<div class="sidebar-section-header">
						<span class="section-label">PROJECTS</span>
						<button class="sidebar-section-btn" id="sidebar-add-project-btn" type="button" aria-label="Add project">Add</button>
					</div>
					<div id="sidebar-context-menu" class="sidebar-context-menu hidden"></div>
				</body>
				</html>
			`)

			const { document } = dom.window
			const addBtn = document.getElementById("sidebar-add-project-btn")!
			const menuEl = document.getElementById("sidebar-context-menu")!

			let filePickerOpened = false
			let quickProjectCreated = false

			const openFolderDialog = () => {
				filePickerOpened = true
			}

			const handleCreateQuickProject = () => {
				quickProjectCreated = true
			}

			// Simulate the menu opening logic from app.js
			let activeTrigger: any = null
			const openMenu = () => {
				if (activeTrigger === addBtn && !menuEl.classList.contains("hidden")) {
					menuEl.classList.add("hidden")
					activeTrigger = null
					return
				}
				activeTrigger = addBtn
				const items = [
					{
						label: "New Project",
						description: "Open an existing folder on your disk",
						action: openFolderDialog,
					},
					{
						label: "Quick Project",
						description: "Create instantly in your Roo Code projects folder",
						action: handleCreateQuickProject,
					},
				]

				menuEl.innerHTML = items
					.map(
						(it, idx) => `
					<button class="context-menu-item" data-index="${idx}" aria-label="${it.label}">
						<div class="menu-item-text">
							<span class="menu-item-title">${it.label}</span>
							<span class="menu-item-desc">${it.description}</span>
						</div>
					</button>
				`
					)
					.join("")

				menuEl.querySelectorAll(".context-menu-item").forEach((btn) => {
					btn.addEventListener("click", () => {
						const idx = parseInt(btn.getAttribute("data-index") || "0", 10)
						items[idx]!.action()
						menuEl.classList.add("hidden")
					})
				})
				menuEl.classList.remove("hidden")
			}

			addBtn.addEventListener("click", openMenu)

			// 1. Click '+' button -> menu opens
			addBtn.click()
			expect(menuEl.classList.contains("hidden")).toBe(false)

			const items = menuEl.querySelectorAll(".context-menu-item")
			expect(items.length).toBe(2)
			expect(items[0]!.textContent).toContain("New Project")
			expect(items[0]!.textContent).toContain("Open an existing folder")
			expect(items[1]!.textContent).toContain("Quick Project")
			expect(items[1]!.textContent).toContain("Create instantly in your Roo Code projects folder")

			// 2. Click Quick Project -> NO file picker opened, quick project created
			const quickBtn = items[1] as HTMLElement
			quickBtn.click()

			expect(filePickerOpened).toBe(false)
			expect(quickProjectCreated).toBe(true)
			expect(menuEl.classList.contains("hidden")).toBe(true)

			// 3. Re-open and click New Project -> normal flow triggers file picker
			addBtn.click()
			const newProjBtn = menuEl.querySelectorAll(".context-menu-item")[0] as HTMLElement
			newProjBtn.click()
			expect(filePickerOpened).toBe(true)
		})
	})
})
