import { describe, it, expect } from "vitest"
import {
	parseExplicitFilesystemScope,
	isPathInScope,
	isValidPathCandidate,
	normalizeScopePath,
} from "../scopeParser"

describe("scopeParser - Canonical Filesystem Scope Parser", () => {
	describe("PHASE 2 & AUDIT REGRESSIONS (Cases A - D)", () => {
		it("CASE A: 'A successful GUI save may change only the intended fields.' extracts NO explicit filesystem allow scope", () => {
			const prompt = "A successful GUI save may change only the intended fields."
			const result = parseExplicitFilesystemScope(prompt)
			expect(result.scopedWriteAllows).toEqual([])
			expect(result.hasExplicitScope).toBe(false)
		})

		it("CASE B: 'You MAY modify ONLY:\n\nlicensing-obfuscation/' extracts licensing-obfuscation and NEVER ':'", () => {
			const prompt = "You MAY modify ONLY:\n\nlicensing-obfuscation/\n\nDo NOT touch any other directory."
			const result = parseExplicitFilesystemScope(prompt)
			expect(result.scopedWriteAllows).toContain("licensing-obfuscation")
			expect(result.scopedWriteAllows).not.toContain(":")
			expect(result.scopedWriteAllows).not.toContain("")
			expect(result.hasExplicitScope).toBe(true)
		})

		it("CASE C: 'modify only src/foo.ts and src/bar.ts' extracts valid explicit paths", () => {
			const prompt = "Please modify only src/foo.ts and src/bar.ts"
			const result = parseExplicitFilesystemScope(prompt)
			expect(result.scopedWriteAllows).toContain("src/foo.ts")
			expect(result.scopedWriteAllows).toContain("src/bar.ts")
			expect(result.hasExplicitScope).toBe(true)
		})

		it("CASE D: 'change only the fields required by this form' extracts NO filesystem path scope", () => {
			const prompt = "Make sure to change only the fields required by this form when submitting."
			const result = parseExplicitFilesystemScope(prompt)
			expect(result.scopedWriteAllows).toEqual([])
			expect(result.hasExplicitScope).toBe(false)
		})
	})

	describe("PHASE 28 — Natural Language Adversarial Tests", () => {
		it("rejects 'Only change the value when the field is dirty.'", () => {
			const prompt = "Only change the value when the field is dirty."
			const result = parseExplicitFilesystemScope(prompt)
			expect(result.scopedWriteAllows).toEqual([])
			expect(result.hasExplicitScope).toBe(false)
		})

		it("rejects 'Modify only what is required.'", () => {
			const prompt = "Modify only what is required for the release blockers described below."
			const result = parseExplicitFilesystemScope(prompt)
			expect(result.scopedWriteAllows).toEqual([])
			expect(result.hasExplicitScope).toBe(false)
		})

		it("rejects 'The save operation may change only intended fields.'", () => {
			const prompt = "The save operation may change only intended fields."
			const result = parseExplicitFilesystemScope(prompt)
			expect(result.scopedWriteAllows).toEqual([])
			expect(result.hasExplicitScope).toBe(false)
		})

		it("rejects 'Only files below are relevant conceptually.'", () => {
			const prompt = "Only files below are relevant conceptually."
			const result = parseExplicitFilesystemScope(prompt)
			expect(result.scopedWriteAllows).toEqual([])
			expect(result.hasExplicitScope).toBe(false)
		})
	})

	describe("PHASE 29 — Real Path Directive Tests", () => {
		it("parses single file directive 'Modify only src/foo.ts'", () => {
			const prompt = "Modify only src/foo.ts"
			const result = parseExplicitFilesystemScope(prompt)
			expect(result.scopedWriteAllows).toEqual(["src/foo.ts"])
		})

		it("parses bulleted multiline directive", () => {
			const prompt = "Modify only:\n- src/foo.ts\n- src/bar.ts"
			const result = parseExplicitFilesystemScope(prompt)
			expect(result.scopedWriteAllows).toEqual(["src/foo.ts", "src/bar.ts"])
		})

		it("parses directory directive 'You may edit only licensing-obfuscation/'", () => {
			const prompt = "You may edit only licensing-obfuscation/"
			const result = parseExplicitFilesystemScope(prompt)
			expect(result.scopedWriteAllows).toEqual(["licensing-obfuscation"])
		})

		it("parses negative directive 'Nie modyfikuj src/secrets.ts'", () => {
			const prompt = "Nie modyfikuj src/secrets.ts ani config/production.json"
			const result = parseExplicitFilesystemScope(prompt)
			expect(result.scopedWriteDenies).toContain("src/secrets.ts")
			expect(result.scopedWriteDenies).toContain("config/production.json")
		})
	})

	describe("PHASE 30 — New File Inside Allowed Directory", () => {
		it("allows new non-existent file inside an allowed directory scope", () => {
			const scopes = ["src/generated"]
			const newTarget = "src/generated/newFile.ts"
			expect(isPathInScope(newTarget, scopes)).toBe(true)
		})

		it("disallows new file outside the allowed directory scope", () => {
			const scopes = ["src/generated"]
			const outsideTarget = "src/other/newFile.ts"
			expect(isPathInScope(outsideTarget, scopes)).toBe(false)
		})
	})

	describe("Path Candidate Validation & Punctuation Rejection", () => {
		it("rejects punctuation-only candidates", () => {
			expect(isValidPathCandidate(":")).toBe(false)
			expect(isValidPathCandidate(",")).toBe(false)
			expect(isValidPathCandidate("-")).toBe(false)
			expect(isValidPathCandidate("...")).toBe(false)
			expect(isValidPathCandidate("/")).toBe(false)
		})

		it("rejects natural language candidate strings", () => {
			expect(isValidPathCandidate("the intended fields")).toBe(false)
			expect(isValidPathCandidate("for the release blockers described below")).toBe(false)
			expect(isValidPathCandidate("the files needed")).toBe(false)
			expect(isValidPathCandidate("the required changes")).toBe(false)
			expect(isValidPathCandidate("what is required")).toBe(false)
		})

		it("accepts valid relative and absolute paths without requiring existence", () => {
			expect(isValidPathCandidate("src/foo.ts")).toBe(true)
			expect(isValidPathCandidate("licensing-obfuscation/")).toBe(true)
			expect(isValidPathCandidate("./src/components/Header.tsx")).toBe(true)
			expect(isValidPathCandidate("newFile.ts")).toBe(true)
			expect(isValidPathCandidate("packages/core/src/index.ts")).toBe(true)
		})
	})

	describe("Canonical Normalization & Matching", () => {
		it("normalizes Windows backslashes to forward slashes", () => {
			const scopes = ["src/foo.ts"]
			expect(isPathInScope("src\\foo.ts", scopes)).toBe(true)
		})

		it("normalizes relative dot segments '.' and '..'", () => {
			const scopes = ["src/foo.ts"]
			expect(isPathInScope("./src/../src/foo.ts", scopes)).toBe(true)
		})

		it("prevents prefix collisions where scope is not a directory boundary", () => {
			const scopes = ["src/foo"]
			expect(isPathInScope("src/foobar.ts", scopes)).toBe(false)
			expect(isPathInScope("src/foo/bar.ts", scopes)).toBe(true)
			expect(isPathInScope("src/foo", scopes)).toBe(true)
		})

		it("resolves nested module paths in workspace root", () => {
			const scopes = ["licensing-obfuscation"]
			const target = "licensing-obfuscation/src/presentation/GuiBridge.js"
			expect(isPathInScope(target, scopes)).toBe(true)
		})
	})
})
