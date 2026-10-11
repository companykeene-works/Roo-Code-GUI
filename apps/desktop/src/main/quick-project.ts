import fs from "fs"
import path from "path"
import os from "os"
import { canonicalizePath, saveDesktopConfig } from "./config.js"
import { getGitBranch, scanWorkspace } from "./server.js"
import type { DesktopAgentHost } from "./agent-host.js"
import type { WorkspaceInfo } from "../shared/types.js"

export const ADJECTIVES = [
	"agile", "astral", "bold", "boundless", "brave", "bright", "calm", "clever",
	"cosmic", "crisp", "curious", "daring", "dynamic", "eager", "epic", "fearless",
	"fierce", "frosty", "gallant", "gentle", "golden", "graceful", "happy", "hardy",
	"harmonic", "ingenious", "intrepid", "jolly", "jubilant", "keen", "kinetic", "lively",
	"lucid", "luminous", "merry", "mindful", "modest", "mystic", "nimble", "noble",
	"patient", "playful", "plucky", "polite", "proud", "quick", "quiet", "radiant",
	"rapid", "resilient", "robust", "rustic", "seraphic", "serene", "sharp", "shining",
	"silent", "sincere", "sparkling", "spirited", "steady", "stellar", "subtle", "swift",
	"tender", "tranquil", "valiant", "vibrant", "vigorous", "vivid", "warm", "wise",
	"witty", "zealous",
]

export const SURNAMES = [
	"babbage", "backus", "bardeen", "bell", "bohr", "boole", "brattain", "burnell",
	"cantor", "cerf", "chatelet", "chomsky", "copernicus", "curie", "darwin", "dijkstra",
	"einstein", "engelbart", "euler", "faraday", "fermat", "feynman", "franklin", "galileo",
	"gauss", "godel", "goodall", "hamilton", "hawking", "hilbert", "hopper", "hubble",
	"hypatia", "kay", "kepler", "kilby", "knuth", "kwolek", "lamport", "leibniz",
	"liskov", "lovelace", "maxwell", "mccarthy", "meitner", "mendel", "minsky", "moore",
	"neumann", "newton", "noether", "noyce", "oppenheimer", "pascal", "pasteur", "planck",
	"riemann", "ritchie", "rubin", "rutherford", "sagan", "shannon", "shockley", "tesla",
	"thompson", "torvalds", "turing", "wilkes", "wilson", "wozniak", "wu",
]

export const WINDOWS_RESERVED_NAMES = new Set([
	"con", "prn", "aux", "nul",
	"com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
	"lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
])

/**
 * Validates that a candidate project folder name is strictly filesystem-safe,
 * lowercase ASCII, free of traversal characters, and not a Windows reserved name.
 */
export function isNameSafe(name: string): boolean {
	if (!name || typeof name !== "string") return false
	const trimmed = name.trim()
	if (trimmed !== name) return false
	if (name.length < 3 || name.length > 100) return false

	// Must be lowercase alphanumeric with hyphens, e.g. "adjective-surname" or "adjective-surname-2"
	if (!/^[a-z0-9]+(-[a-z0-9]+)+$/.test(name)) return false

	// Prohibit directory traversal and prohibited Windows characters
	if (/[\/\\:\*\?"<>\|\.]/.test(name)) return false
	if (name.includes("..")) return false

	// Check against reserved names
	const baseName = name.split(".")[0]?.toLowerCase() || ""
	if (WINDOWS_RESERVED_NAMES.has(baseName)) return false

	return true
}

/**
 * Generates a random adjective-surname project name.
 */
export function generateQuickProjectName(): string {
	const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]!
	const sur = SURNAMES[Math.floor(Math.random() * SURNAMES.length)]!
	return `${adj}-${sur}`
}

/**
 * Resolves the user's system Documents directory.
 * Prioritizes native Electron app.getPath("documents") when available,
 * and falls back to os.homedir()/Documents.
 */
export function getDocumentsDirectory(): string {
	try {
		// Electron detection: check globalThis or attempt require
		const electron = (globalThis as any).electron || (typeof require === "function" ? require("electron") : null)
		const app = electron?.app || electron?.default?.app
		if (app && typeof app.getPath === "function") {
			const docPath = app.getPath("documents")
			if (docPath && typeof docPath === "string" && docPath.trim()) {
				return canonicalizePath(docPath)
			}
		}
	} catch {}

	return canonicalizePath(path.join(os.homedir(), "Documents"))
}

/**
 * Returns the default root directory for quick projects:
 * <Documents>\roocode
 */
export function getQuickProjectsRoot(): string {
	const docsDir = getDocumentsDirectory()
	return path.join(docsDir, "roocode")
}

export interface QuickProjectDirectoryResult {
	path: string
	name: string
}

/**
 * Atomically creates a unique quick project directory under rootDir.
 * Handles missing root directory, collision retries, and atomic mkdir semantics.
 */
export function createQuickProjectDirectory(options?: {
	rootDir?: string
	maxAttempts?: number
}): QuickProjectDirectoryResult {
	const root = options?.rootDir ? path.resolve(options.rootDir) : getQuickProjectsRoot()
	const maxAttempts = options?.maxAttempts ?? 100

	// Ensure root directory exists
	if (!fs.existsSync(root)) {
		try {
			fs.mkdirSync(root, { recursive: true })
		} catch (err: any) {
			throw new Error(`Failed to create Quick Projects root directory "${root}": ${err?.message || err}`)
		}
	}

	const resolvedRoot = path.resolve(root)

	// Try generating random names with atomic mkdir
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		const candidateName = generateQuickProjectName()
		if (!isNameSafe(candidateName)) continue

		const candidatePath = path.join(resolvedRoot, candidateName)
		const resolvedCandidate = path.resolve(candidatePath)

		// Path traversal security check
		if (!resolvedCandidate.startsWith(resolvedRoot + path.sep)) {
			continue
		}

		try {
			// Non-recursive mkdir ensures atomic creation: throws EEXIST if already exists
			fs.mkdirSync(candidatePath)
			return {
				path: canonicalizePath(candidatePath),
				name: candidateName,
			}
		} catch (err: any) {
			if (err?.code === "EEXIST") {
				// Name collision, try next
				continue
			}
			throw new Error(`Failed to create project folder "${candidatePath}": ${err?.message || err}`)
		}
	}

	// Fallback strategy 1: append index to random name
	for (let i = 2; i <= 200; i++) {
		const baseName = generateQuickProjectName()
		const fallbackName = `${baseName}-${i}`
		if (!isNameSafe(fallbackName)) continue

		const candidatePath = path.join(resolvedRoot, fallbackName)
		try {
			fs.mkdirSync(candidatePath)
			return {
				path: canonicalizePath(candidatePath),
				name: fallbackName,
			}
		} catch (err: any) {
			if (err?.code === "EEXIST") continue
			throw new Error(`Failed to create fallback project folder "${candidatePath}": ${err?.message || err}`)
		}
	}

	// Fallback strategy 2: short timestamp
	const timestampName = `quick-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
	const tsPath = path.join(resolvedRoot, timestampName)
	try {
		fs.mkdirSync(tsPath)
		return {
			path: canonicalizePath(tsPath),
			name: timestampName,
		}
	} catch (err: any) {
		throw new Error(`Failed to create timestamped project folder "${tsPath}": ${err?.message || err}`)
	}
}

export interface QuickProjectResult {
	path: string
	name: string
	workspace: WorkspaceInfo
}

/**
 * Creates and registers a new Quick Project using Roo's internal workspace pipeline.
 * Activates the project, saves config, updates recentWorkspaces, and notifies listeners.
 */
export async function createQuickProject(
	agentHost: Pick<DesktopAgentHost, "setWorkspace" | "getWorkspace" | "getDiffFiles">,
	options?: {
		rootDir?: string
		broadcast?: (msg: any) => void
		broadcastSidebarData?: () => void
	}
): Promise<QuickProjectResult> {
	const { path: createdPath, name } = createQuickProjectDirectory({ rootDir: options?.rootDir })

	let registrationSucceeded = false
	try {
		const normalized = canonicalizePath(createdPath)
		await agentHost.setWorkspace(normalized)
		saveDesktopConfig({ lastWorkspacePath: normalized })
		const folderScan = scanWorkspace(normalized)
		const newWs: WorkspaceInfo = {
			path: normalized,
			name: path.basename(normalized),
			branch: getGitBranch(normalized),
			files: folderScan.files,
			directories: folderScan.directories,
		}

		if (typeof options?.broadcast === "function") {
			options.broadcast({ type: "workspaceInfo", workspace: newWs })
			options.broadcast({ type: "diffsUpdated", diffs: agentHost.getDiffFiles() })
		}

		if (typeof options?.broadcastSidebarData === "function") {
			options.broadcastSidebarData()
		}

		registrationSucceeded = true
		return {
			path: normalized,
			name,
			workspace: newWs,
		}
	} catch (err: any) {
		// Clean up empty directory if registration failed so we do not leave orphan empty folders
		if (!registrationSucceeded) {
			try {
				if (fs.existsSync(createdPath) && fs.readdirSync(createdPath).length === 0) {
					fs.rmdirSync(createdPath)
				}
			} catch {}
		}
		throw new Error(`Failed to register quick project "${createdPath}": ${err?.message || err}`)
	}
}
