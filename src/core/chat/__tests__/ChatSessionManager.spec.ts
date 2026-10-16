import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import fs from "fs"
import path from "path"
import os from "os"
import { ChatSessionManager } from "../ChatSessionManager"
import { generateChatTitle } from "../title"

describe("ChatSessionManager & Title Generation", () => {
	let tempDir: string
	let manager: ChatSessionManager

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "roo-chat-test-"))
		manager = new ChatSessionManager({
			storageDir: tempDir,
			getGlobalSettings: () => ({
				apiProvider: "xkiro",
				xkiroApiKey: "mock-xkiro-key",
			}),
			getSecret: (key: string) => (key === "xkiroApiKey" ? "mock-xkiro-key" : undefined),
		})
	})

	afterEach(() => {
		try {
			fs.rmSync(tempDir, { recursive: true, force: true })
		} catch {}
	})

	describe("title generation", () => {
		it("cleans code fences, markdown headers, and symbols", () => {
			const prompt = "```typescript\nconst a = 1\n```\n# Zaimplementuj nowy algorytm sortowania"
			expect(generateChatTitle(prompt)).toBe("Zaimplementuj nowy algorytm sortowania")
		})

		it("cleans bullet points and checkboxes", () => {
			const prompt = "- [ ] Napraw błąd w formularzu logowania"
			expect(generateChatTitle(prompt)).toBe("Napraw błąd w formularzu logowania")
		})

		it("clamps titles longer than maxLength", () => {
			const longPrompt = "To jest bardzo długie zapytanie do sztucznej inteligencji, które powinno zostać skrócone z wielokropkiem na końcu"
			const title = generateChatTitle(longPrompt, 30)
			expect(title.length).toBeLessThanOrEqual(30)
			expect(title.endsWith("...")).toBe(true)
		})
	})

	describe("Session CRUD & Storage Isolation", () => {
		it("creates a new session and saves to isolated chat-sessions directory", async () => {
			const session = await manager.createSession({ title: "Pierwsza rozmowa" })
			expect(session.id).toBeDefined()
			expect(session.title).toBe("Pierwsza rozmowa")
			expect(session.messages).toEqual([])

			// Verify file exists in chat-sessions/
			const sessionFile = path.join(tempDir, "global-storage", "chat-sessions", `${session.id}.json`)
			expect(fs.existsSync(sessionFile)).toBe(true)

			// Verify tasks/ directory was NOT created
			const tasksDir = path.join(tempDir, "global-storage", "tasks")
			expect(fs.existsSync(tasksDir)).toBe(false)
		})

		it("lists sessions from index sorted by updatedAt descending", async () => {
			const s1 = await manager.createSession({ title: "Chat 1" })
			await new Promise((r) => setTimeout(r, 10))
			const s2 = await manager.createSession({ title: "Chat 2" })

			const list = await manager.listSessions()
			expect(list.length).toBe(2)
			expect(list[0].id).toBe(s2.id)
			expect(list[1].id).toBe(s1.id)
		})

		it("gets session by id", async () => {
			const session = await manager.createSession({ title: "Test Chat" })
			const loaded = await manager.getSession(session.id)
			expect(loaded).toBeDefined()
			expect(loaded?.id).toBe(session.id)
			expect(loaded?.title).toBe("Test Chat")
		})

		it("renames a session and sets titleSource to manual", async () => {
			const session = await manager.createSession({ title: "Initial Title" })
			const renamed = await manager.renameSession(session.id, "Nowy Tytuł")
			expect(renamed).toBe(true)

			const loaded = await manager.getSession(session.id)
			expect(loaded?.title).toBe("Nowy Tytuł")
			expect(loaded?.titleSource).toBe("manual")

			const list = await manager.listSessions()
			expect(list.find((s) => s.id === session.id)?.title).toBe("Nowy Tytuł")
		})

		it("saves drafts without corrupting conversation history", async () => {
			const session = await manager.createSession()
			await manager.saveDraft(session.id, {
				text: "Draft in progress",
				webSearchMode: "required",
			})

			const loaded = await manager.getSession(session.id)
			expect(loaded?.draft?.text).toBe("Draft in progress")
			expect(loaded?.draft?.webSearchMode).toBe("required")
		})

		it("deletes a session and removes it from disk and index", async () => {
			const session = await manager.createSession({ title: "To Delete" })
			const deleted = await manager.deleteSession(session.id)
			expect(deleted).toBe(true)

			const loaded = await manager.getSession(session.id)
			expect(loaded).toBeNull()

			const list = await manager.listSessions()
			expect(list.some((s) => s.id === session.id)).toBe(false)
		})
	})

	describe("Preferences Isolation", () => {
		it("stores and loads chat preferences independently", async () => {
			await manager.savePreferences({
				apiProvider: "xkiro",
				modelId: "openai/gpt-5.6-terra",
				reasoningEffort: "high",
				webSearchMode: "required",
				enabled: true,
			})

			const loaded = await manager.getPreferences()
			expect(loaded.apiProvider).toBe("xkiro")
			expect(loaded.modelId).toBe("openai/gpt-5.6-terra")
			expect(loaded.reasoningEffort).toBe("high")
			expect(loaded.webSearchMode).toBe("required")
		})

		it("abortStream does not throw when session is not streaming", () => {
			expect(() => manager.abortStream("non-existent")).not.toThrow()
		})
	})
})
