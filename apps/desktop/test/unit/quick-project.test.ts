import { describe, it, expect, beforeEach, afterEach } from "vitest"
import path from "path"
import fs from "fs"
import os from "os"
import {
	ADJECTIVES,
	SURNAMES,
	WINDOWS_RESERVED_NAMES,
	isNameSafe,
	generateQuickProjectName,
	getDocumentsDirectory,
	getQuickProjectsRoot,
	createQuickProjectDirectory,
} from "../../src/main/quick-project.js"

describe("Quick Project Unit Tests", () => {
	let tempDir: string

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "roo-qp-unit-"))
	})

	afterEach(() => {
		try {
			fs.rmSync(tempDir, { recursive: true, force: true })
		} catch {}
	})

	describe("1. Word Lists & Name Format (Phase 4 & 5)", () => {
		it("ADJECTIVES has at least 50 items and all are lowercase ASCII", () => {
			expect(ADJECTIVES.length).toBeGreaterThanOrEqual(50)
			for (const adj of ADJECTIVES) {
				expect(adj).toMatch(/^[a-z]+$/)
			}
		})

		it("SURNAMES has at least 50 items and all are lowercase ASCII", () => {
			expect(SURNAMES.length).toBeGreaterThanOrEqual(50)
			for (const sur of SURNAMES) {
				expect(sur).toMatch(/^[a-z]+$/)
			}
		})

		it("generateQuickProjectName outputs format <adjective>-<surname>", () => {
			for (let i = 0; i < 50; i++) {
				const name = generateQuickProjectName()
				expect(name).toMatch(/^[a-z]+-[a-z]+$/)
				const [adj, sur] = name.split("-")
				expect(ADJECTIVES).toContain(adj)
				expect(SURNAMES).toContain(sur)
				expect(isNameSafe(name)).toBe(true)
			}
		})
	})

	describe("2. Security, Windows Reserved Names & Path Traversal (Phase 18 & 19)", () => {
		it("accepts valid names", () => {
			expect(isNameSafe("serene-oppenheimer")).toBe(true)
			expect(isNameSafe("vibrant-goodall")).toBe(true)
			expect(isNameSafe("calm-turing-2")).toBe(true)
			expect(isNameSafe("quick-abc123-xyz")).toBe(true)
		})

		it("rejects path traversal and directory separators", () => {
			expect(isNameSafe("../traversal")).toBe(false)
			expect(isNameSafe("foo/bar")).toBe(false)
			expect(isNameSafe("foo\\bar")).toBe(false)
			expect(isNameSafe("..")).toBe(false)
			expect(isNameSafe("./foo")).toBe(false)
			expect(isNameSafe("foo..bar")).toBe(false)
		})

		it("rejects Windows reserved device names", () => {
			for (const res of WINDOWS_RESERVED_NAMES) {
				expect(isNameSafe(res)).toBe(false)
				expect(isNameSafe(`${res}.txt`)).toBe(false)
			}
		})

		it("rejects illegal Windows characters and trailing dots/spaces", () => {
			expect(isNameSafe("invalid:name")).toBe(false)
			expect(isNameSafe("invalid*name")).toBe(false)
			expect(isNameSafe("invalid?name")).toBe(false)
			expect(isNameSafe("invalid\"name")).toBe(false)
			expect(isNameSafe("invalid<name")).toBe(false)
			expect(isNameSafe("invalid>name")).toBe(false)
			expect(isNameSafe("invalid|name")).toBe(false)
			expect(isNameSafe("invalid-name.")).toBe(false)
			expect(isNameSafe(" invalid-name ")).toBe(false)
			expect(isNameSafe("UPPERCASE-NAME")).toBe(false)
		})
	})

	describe("3. Root Resolution (Phase 8)", () => {
		it("getDocumentsDirectory resolves to a valid Documents folder", () => {
			const docs = getDocumentsDirectory()
			expect(docs).toBeTruthy()
			expect(path.isAbsolute(docs)).toBe(true)
			expect(docs.toLowerCase()).toContain("documents")
		})

		it("getQuickProjectsRoot ends with roocode under documents", () => {
			const root = getQuickProjectsRoot()
			expect(root).toBeTruthy()
			expect(path.isAbsolute(root)).toBe(true)
			expect(root.endsWith("roocode") || root.endsWith("roocode\\") || root.endsWith("roocode/")).toBe(true)
		})
	})

	describe("4. Directory Creation & Collision Handling (Phase 6, 7, 9, 13)", () => {
		it("creates root directory recursively if it does not exist", () => {
			const customRoot = path.join(tempDir, "nested", "level", "roocode")
			expect(fs.existsSync(customRoot)).toBe(false)

			const result = createQuickProjectDirectory({ rootDir: customRoot })
			expect(fs.existsSync(customRoot)).toBe(true)
			expect(fs.existsSync(result.path)).toBe(true)
			expect(result.path.startsWith(customRoot)).toBe(true)
		})

		it("reuses existing root directory without recreating it", () => {
			const customRoot = path.join(tempDir, "existing-roocode")
			fs.mkdirSync(customRoot, { recursive: true })
			const markerFile = path.join(customRoot, "marker.txt")
			fs.writeFileSync(markerFile, "keep-me")

			const result = createQuickProjectDirectory({ rootDir: customRoot })
			expect(fs.existsSync(result.path)).toBe(true)
			expect(fs.existsSync(markerFile)).toBe(true)
			expect(fs.readFileSync(markerFile, "utf-8")).toBe("keep-me")
		})

		it("creates empty project folder without automatic readme or git files (Phase 13, 14)", () => {
			const result = createQuickProjectDirectory({ rootDir: tempDir })
			const files = fs.readdirSync(result.path)
			expect(files).toEqual([])
			expect(fs.existsSync(path.join(result.path, ".git"))).toBe(false)
			expect(fs.existsSync(path.join(result.path, "README.md"))).toBe(false)
			expect(fs.existsSync(path.join(result.path, "package.json"))).toBe(false)
		})

		it("handles name collision and generates another unique name", () => {
			// Pre-create several project folders in tempDir
			const existingNames = ["serene-oppenheimer", "calm-turing", "vibrant-goodall"]
			for (const n of existingNames) {
				fs.mkdirSync(path.join(tempDir, n))
			}

			const result = createQuickProjectDirectory({ rootDir: tempDir })
			expect(fs.existsSync(result.path)).toBe(true)
			expect(existingNames).not.toContain(result.name)
		})

		it("creates multiple quick projects, each unique", () => {
			const created = new Set<string>()
			for (let i = 0; i < 5; i++) {
				const res = createQuickProjectDirectory({ rootDir: tempDir })
				expect(created.has(res.path)).toBe(false)
				expect(created.has(res.name)).toBe(false)
				created.add(res.path)
				created.add(res.name)
				expect(fs.existsSync(res.path)).toBe(true)
			}
			expect(created.size).toBe(10) // 5 paths + 5 names
		})
	})
})
