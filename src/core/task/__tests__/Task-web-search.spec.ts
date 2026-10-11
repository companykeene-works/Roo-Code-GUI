import { describe, it, expect, beforeEach, vi } from "vitest"
import { Task } from "../Task"
import { MessageQueueService } from "../../message-queue/MessageQueueService"



describe("Task - Web Search Mode Resolution", () => {
	it("resolves /web command and strips prefix to produce cleanText", () => {
		const result = Task.prototype.resolveWebSearchMode("/web latest React 19 documentation")
		expect(result.mode).toBe("required")
		expect(result.cleanedText).toBe("latest React 19 documentation")
	})

	it("resolves natural language phrases in Polish and English", () => {
		expect(Task.prototype.resolveWebSearchMode("sprawdź online najnowszy release").mode).toBe("required")
		expect(Task.prototype.resolveWebSearchMode("wyszukaj w internecie changelog").mode).toBe("required")
		expect(Task.prototype.resolveWebSearchMode("zrób research na temat nowej biblioteki").mode).toBe("required")
		expect(Task.prototype.resolveWebSearchMode("search the web for migration guide").mode).toBe("required")
		expect(Task.prototype.resolveWebSearchMode("look this up online please").mode).toBe("required")
	})

	it("preserves explicit webSearchMode over text analysis", () => {
		const result = Task.prototype.resolveWebSearchMode("Just normal code question", "required")
		expect(result.mode).toBe("required")
		expect(result.cleanedText).toBe("Just normal code question")
	})

	it("respects explicit 'off' mode even when natural language triggers exist", () => {
		const result = Task.prototype.resolveWebSearchMode("search the web", "off")
		expect(result.mode).toBe("off")
	})

	it("defaults to 'auto' for general queries without web phrases", () => {
		const result = Task.prototype.resolveWebSearchMode("Refactor this function to be pure")
		expect(result.mode).toBe("auto")
		expect(result.cleanedText).toBe("Refactor this function to be pure")
	})
})

describe("MessageQueueService - Web Search Mode Persistence", () => {
	it("persists webSearchMode in queued message", () => {
		const queueService = new MessageQueueService()
		queueService.addMessage("Search for updates", [], "required")

		const messages = queueService.messages
		expect(messages).toHaveLength(1)
		expect(messages[0].text).toBe("Search for updates")
		expect(messages[0].webSearchMode).toBe("required")
	})

	it("defaults queued message webSearchMode to undefined or auto when omitted", () => {
		const queueService = new MessageQueueService()
		queueService.addMessage("Regular queued message", [])

		const messages = queueService.messages
		expect(messages).toHaveLength(1)
		expect(messages[0].webSearchMode).toBeUndefined()
	})
})
