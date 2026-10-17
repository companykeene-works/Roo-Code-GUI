import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import fs from "fs"
import path from "path"
import os from "os"
import { ChatSessionManager } from "../ChatSessionManager"
import { WebSearchService } from "../../../services/web-search/WebSearchService"
import { validateUrlSafety } from "../../../services/web-search/ssrf"
import type { ChatMessage } from "@roo-code/types"
import type { SearchResultItem } from "../../../services/web-search/types"

describe("Native Chat Web Search Regression & Grounding Tests (TEST A - S)", () => {
	let tempDir: string
	let chatManager: ChatSessionManager
	let secretStore: Record<string, string>
	let globalSettingsStore: Record<string, any>

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "roo-chat-websearch-"))
		secretStore = {
			xkiroApiKey: "test-xkiro-key",
			webSearchApiKey: "test-brave-key",
		}
		globalSettingsStore = {
			webSearchEnabled: true,
			webSearchProvider: "brave",
			webSearchApiKey: "test-brave-key",
			webSearchMaxResults: 5,
		}
	})

	afterEach(() => {
		try {
			fs.rmSync(tempDir, { recursive: true, force: true })
		} catch {}
		vi.restoreAllMocks()
	})

	// Helper to instantiate ChatSessionManager with test store
	function createChatManager(): ChatSessionManager {
		return new ChatSessionManager({
			storageDir: tempDir,
			getGlobalSettings: () => globalSettingsStore,
			getSecret: (key: string) => secretStore[key],
		})
	}

	// TEST A — EXPLICIT SEARCH INTENT: "jeżeli nie wiesz o co chodzi to przeszukaj internet" in context of xKiro
	it("TEST A: Explicit search intent in Polish triggers Web Search with contextual query", async () => {
		chatManager = createChatManager()
		const session = await chatManager.createSession({
			title: "xKiro context chat",
			modelPreference: {
				apiProvider: "xkiro",
				modelId: "openai/gpt-6.1-sol",
				webSearchMode: "auto",
			},
		})

		// Add prior turns establishing the topic about xKiro
		session.messages.push({
			id: "m1",
			role: "user",
			content: "Czym właściwie jest usługa xKiro?",
			timestamp: Date.now() - 2000,
		})
		session.messages.push({
			id: "m2",
			role: "assistant",
			content: "Nie jestem do końca pewien, czym jest xKiro.",
			timestamp: Date.now() - 1000,
		})
		await chatManager.saveSession(session)

		const searchSpy = vi.spyOn(WebSearchService.getInstance(), "search").mockResolvedValue([
			{
				title: "xKiro - Official AI Gateway & Infrastructure",
				url: "https://xkiro.com",
				snippet: "xKiro is an enterprise AI proxy and developer platform providing unified model access.",
				domain: "xkiro.com",
			},
		])

		// Mock buildApiHandler
		const apiModule = await import("../../../api")
		let capturedSystemPrompt = ""
		const mockHandler = {
			createMessage: vi.fn().mockImplementation(async function* (systemPrompt: string) {
				capturedSystemPrompt = systemPrompt
				yield { type: "text", text: "xKiro to platforma pośrednicząca dla modeli AI..." }
			}),
		}
		vi.spyOn(apiModule, "buildApiHandler").mockReturnValue(mockHandler as any)

		const response = await chatManager.sendMessage({
			sessionId: session.id,
			text: "jeżeli nie wiesz o co chodzi to przeszukaj internet",
			webSearchMode: "auto",
		})

		// Verify search was triggered
		expect(searchSpy).toHaveBeenCalled()
		// Verify the search query captures the context (e.g. xKiro) rather than literal meta-phrase
		const queryArg = searchSpy.mock.calls[0][0]
		expect(queryArg.toLowerCase()).toContain("xkiro")

		// Verify assistant message received search data
		expect(response.webSearch).toBeDefined()
		expect(response.webSearch?.results.length).toBe(1)
		expect(response.webSearch?.results[0].title).toBe("xKiro - Official AI Gateway & Infrastructure")
		expect(response.webSearch?.results[0].url).toBe("https://xkiro.com")

		// Verify search config was passed as config object (3rd parameter), not as options (2nd parameter)
		const configArg = searchSpy.mock.calls[0][2]
		expect(configArg).toBeDefined()
		expect(configArg?.apiKey).toBe("test-brave-key")
	})

	// TEST B — REAL RESULTS IN MODEL CONTEXT: Model prompt contains verified sources
	it("TEST B: Outgoing request to model contains properly prepared search context and sources", async () => {
		chatManager = createChatManager()
		const session = await chatManager.createSession({
			title: "Grounded context test",
			modelPreference: {
				apiProvider: "xkiro",
				modelId: "openai/gpt-6.1-sol",
				webSearchMode: "auto",
			},
		})

		const mockResults: SearchResultItem[] = [
			{
				title: "Roo Code Release 3.53",
				url: "https://github.com/RooCodeInc/Roo-Code/releases/tag/v3.53.0",
				snippet: "Introduced Native AI Chat, search controls, and improved performance.",
				domain: "github.com",
				publishedAt: "2026-10-15",
			},
		]
		vi.spyOn(WebSearchService.getInstance(), "search").mockResolvedValue(mockResults)

		const apiModule = await import("../../../api")
		let capturedSystemPrompt = ""
		const mockHandler = {
			createMessage: vi.fn().mockImplementation(async function* (systemPrompt: string) {
				capturedSystemPrompt = systemPrompt
				yield { type: "text", text: "Oto informacje o Roo Code 3.53 z oficjalnego changeloga." }
			}),
		}
		vi.spyOn(apiModule, "buildApiHandler").mockReturnValue(mockHandler as any)

		await chatManager.sendMessage({
			sessionId: session.id,
			text: "wyszukaj w internecie najnowszy changelog Roo Code 3.53",
			webSearchMode: "auto",
		})

		// Outgoing systemPrompt must contain search results with title, URL and snippet
		expect(capturedSystemPrompt).toContain("Roo Code Release 3.53")
		expect(capturedSystemPrompt).toContain("https://github.com/RooCodeInc/Roo-Code/releases/tag/v3.53.0")
		expect(capturedSystemPrompt).toContain("Introduced Native AI Chat")
	})

	// TEST C — NO FALSE NO-INTERNET RESPONSE: System instructs model with grounded facts
	it("TEST C: Model prompt prevents false claims of lacking internet access when results exist", async () => {
		chatManager = createChatManager()
		const session = await chatManager.createSession({
			title: "Internet grounding test",
			modelPreference: {
				apiProvider: "xkiro",
				modelId: "openai/gpt-6.1-sol",
				webSearchMode: "auto",
			},
		})

		vi.spyOn(WebSearchService.getInstance(), "search").mockResolvedValue([
			{
				title: "Example Title",
				url: "https://example.com",
				snippet: "Example snippet information.",
				domain: "example.com",
			},
		])

		const apiModule = await import("../../../api")
		let capturedSystemPrompt = ""
		const mockHandler = {
			createMessage: vi.fn().mockImplementation(async function* (systemPrompt: string) {
				capturedSystemPrompt = systemPrompt
				yield { type: "text", text: "Znalazłem stronę example.com" }
			}),
		}
		vi.spyOn(apiModule, "buildApiHandler").mockReturnValue(mockHandler as any)

		await chatManager.sendMessage({
			sessionId: session.id,
			text: "sprawdź w internecie example.com",
			webSearchMode: "auto",
		})

		// Prompt must explicitly instruct the model about available web results
		expect(capturedSystemPrompt).toMatch(/(live web search|web search results|sources)/i)
		expect(capturedSystemPrompt).toContain("https://example.com")
	})

	// TEST D — SEARCH DISABLED: Search: Off suppresses web search completely
	it("TEST D: Search Off does not execute web search even if message explicitly asks for internet", async () => {
		chatManager = createChatManager()
		const session = await chatManager.createSession({
			title: "Search Off test",
			modelPreference: {
				apiProvider: "xkiro",
				modelId: "openai/gpt-6.1-sol",
				webSearchMode: "off",
			},
		})

		const searchSpy = vi.spyOn(WebSearchService.getInstance(), "search")

		const apiModule = await import("../../../api")
		let capturedSystemPrompt = ""
		const mockHandler = {
			createMessage: vi.fn().mockImplementation(async function* (systemPrompt: string) {
				capturedSystemPrompt = systemPrompt
				yield { type: "text", text: "Odpowiadam bez wyszukiwania..." }
			}),
		}
		vi.spyOn(apiModule, "buildApiHandler").mockReturnValue(mockHandler as any)

		const response = await chatManager.sendMessage({
			sessionId: session.id,
			text: "wyszukaj w internecie informacje o xkiro",
			webSearchMode: "off",
		})

		expect(searchSpy).not.toHaveBeenCalled()
		expect(response.webSearch).toBeUndefined()
		expect(capturedSystemPrompt).not.toContain("[Web Search Results")
	})

	// TEST E — AUTO WITHOUT NEED: Ordinary questions do not trigger web search
	it("TEST E: Search: Auto does not execute web search for ordinary coding questions", async () => {
		chatManager = createChatManager()
		const session = await chatManager.createSession({
			title: "Code question test",
			modelPreference: {
				apiProvider: "xkiro",
				modelId: "openai/gpt-6.1-sol",
				webSearchMode: "auto",
			},
		})

		const searchSpy = vi.spyOn(WebSearchService.getInstance(), "search")

		const apiModule = await import("../../../api")
		const mockHandler = {
			createMessage: vi.fn().mockImplementation(async function* () {
				yield { type: "text", text: "Oto implementacja funkcji dodającej..." }
			}),
		}
		vi.spyOn(apiModule, "buildApiHandler").mockReturnValue(mockHandler as any)

		const response = await chatManager.sendMessage({
			sessionId: session.id,
			text: "Napisz czystą funkcję w TypeScript dodającą dwie liczby",
			webSearchMode: "auto",
		})

		expect(searchSpy).not.toHaveBeenCalled()
		expect(response.webSearch).toBeUndefined()
	})

	// TEST F — REQUIRED SEARCH: Search: Required triggers search unconditionally
	it("TEST F: Search: Required triggers web search even for questions without explicit search keywords", async () => {
		chatManager = createChatManager()
		const session = await chatManager.createSession({
			title: "Required search test",
			modelPreference: {
				apiProvider: "xkiro",
				modelId: "openai/gpt-6.1-sol",
				webSearchMode: "required",
			},
		})

		const searchSpy = vi.spyOn(WebSearchService.getInstance(), "search").mockResolvedValue([
			{
				title: "TS 5.8 Features",
				url: "https://devblogs.microsoft.com/typescript/announcing-typescript-5-8/",
				snippet: "TypeScript 5.8 introduces checks for return statements and more.",
				domain: "devblogs.microsoft.com",
			},
		])

		const apiModule = await import("../../../api")
		const mockHandler = {
			createMessage: vi.fn().mockImplementation(async function* () {
				yield { type: "text", text: "TypeScript 5.8 wprowadza nowe reguły..." }
			}),
		}
		vi.spyOn(apiModule, "buildApiHandler").mockReturnValue(mockHandler as any)

		const response = await chatManager.sendMessage({
			sessionId: session.id,
			text: "TypeScript 5.8",
			webSearchMode: "required",
		})

		expect(searchSpy).toHaveBeenCalled()
		expect(response.webSearch).toBeDefined()
	})

	// TEST G — SEARCH PROVIDER NOT CONFIGURED: Shows specific problem without pretending search occurred
	it("TEST G: Reports specific configuration problem when search backend is not configured", async () => {
		// Provide no search API key and disabled provider
		globalSettingsStore = {
			webSearchEnabled: false,
		}
		secretStore = {
			xkiroApiKey: "test-xkiro-key",
		}

		chatManager = createChatManager()
		const session = await chatManager.createSession({
			title: "Unconfigured search test",
			modelPreference: {
				apiProvider: "xkiro",
				modelId: "openai/gpt-6.1-sol",
				webSearchMode: "required",
			},
		})

		const apiModule = await import("../../../api")
		const mockHandler = {
			createMessage: vi.fn(),
		}
		vi.spyOn(apiModule, "buildApiHandler").mockReturnValue(mockHandler as any)

		const response = await chatManager.sendMessage({
			sessionId: session.id,
			text: "sprawdź najnowsze informacje w internecie",
			webSearchMode: "required",
		})

		// Should report that search is disabled or not configured
		expect(response.error).toBeDefined()
		expect(response.error).toMatch(/(web search|web access|disabled|configured|api key)/i)
		expect(response.webSearch).toBeUndefined()

		// Verify session history preserved
		const reloaded = await chatManager.getSession(session.id)
		expect(reloaded?.messages.length).toBe(2)
		expect(reloaded?.messages[1].error).toBeDefined()
	})

	// TEST H — SEARCH PROVIDER ERROR: HTTP/network errors are reported cleanly and history is preserved
	it("TEST H: Network/HTTP error during search is caught, reported, and history preserved", async () => {
		chatManager = createChatManager()
		const session = await chatManager.createSession({
			title: "Search error test",
			modelPreference: {
				apiProvider: "xkiro",
				modelId: "openai/gpt-6.1-sol",
				webSearchMode: "required",
			},
		})

		vi.spyOn(WebSearchService.getInstance(), "search").mockRejectedValue(
			new Error("Brave Search rate limit reached (HTTP 429). Please wait before trying again."),
		)

		const apiModule = await import("../../../api")
		const mockHandler = {
			createMessage: vi.fn(),
		}
		vi.spyOn(apiModule, "buildApiHandler").mockReturnValue(mockHandler as any)

		const response = await chatManager.sendMessage({
			sessionId: session.id,
			text: "wyszukaj najnowsze wiadomości",
			webSearchMode: "required",
		})

		expect(response.error).toBeDefined()
		expect(response.error).toContain("429")

		const reloaded = await chatManager.getSession(session.id)
		expect(reloaded?.messages.length).toBe(2)
		expect(reloaded?.messages[0].content).toBe("wyszukaj najnowsze wiadomości")
		expect(reloaded?.messages[1].error).toContain("429")
	})

	// TEST I — SOURCES: Only genuine URLs and titles from backend are attached
	it("TEST I: Only authentic search results from backend are recorded as sources", async () => {
		chatManager = createChatManager()
		const session = await chatManager.createSession({
			title: "Sources test",
			modelPreference: {
				apiProvider: "xkiro",
				modelId: "openai/gpt-6.1-sol",
				webSearchMode: "auto",
			},
		})

		const mockResults: SearchResultItem[] = [
			{
				title: "Verified Documentation",
				url: "https://docs.example.org/guide",
				snippet: "Verified snippet text.",
				domain: "docs.example.org",
			},
		]
		vi.spyOn(WebSearchService.getInstance(), "search").mockResolvedValue(mockResults)

		const apiModule = await import("../../../api")
		const mockHandler = {
			createMessage: vi.fn().mockImplementation(async function* () {
				yield { type: "text", text: "Zgodnie z dokumentacją..." }
			}),
		}
		vi.spyOn(apiModule, "buildApiHandler").mockReturnValue(mockHandler as any)

		const response = await chatManager.sendMessage({
			sessionId: session.id,
			text: "wyszukaj verified documentation",
			webSearchMode: "auto",
		})

		expect(response.webSearch?.results).toEqual([
			{
				title: "Verified Documentation",
				url: "https://docs.example.org/guide",
				snippet: "Verified snippet text.",
				domain: "docs.example.org",
				publishedAt: undefined,
			},
		])
	})

	// TEST J — FETCH_URL SECURITY: SSRF, localhost, private IP and dangerous schemes are blocked
	it("TEST J: URL safety validation blocks localhost, private IPs and cloud metadata", async () => {
		await expect(validateUrlSafety("http://localhost:8080/admin")).rejects.toThrow()
		await expect(validateUrlSafety("http://127.0.0.1:3000")).rejects.toThrow()
		await expect(validateUrlSafety("http://169.254.169.254/latest/meta-data")).rejects.toThrow()
		await expect(validateUrlSafety("http://192.168.1.1/router")).rejects.toThrow()
		await expect(validateUrlSafety("http://10.0.0.1")).rejects.toThrow()
		await expect(validateUrlSafety("ftp://example.com/file")).rejects.toThrow()
	})

	// TEST K — XKIRO COMPATIBILITY: Chat with GPT-6.1 Sol via xKiro receives grounded prompt
	it("TEST K: xKiro provider handler receives complete search results and executes stream", async () => {
		chatManager = createChatManager()
		const session = await chatManager.createSession({
			title: "xKiro GPT-6.1 Sol Search",
			modelPreference: {
				apiProvider: "xkiro",
				modelId: "openai/gpt-6.1-sol",
				webSearchMode: "auto",
			},
		})

		vi.spyOn(WebSearchService.getInstance(), "search").mockResolvedValue([
			{
				title: "xKiro Architecture & Features",
				url: "https://xkiro.com/features",
				snippet: "Details about xKiro enterprise routing.",
				domain: "xkiro.com",
			},
		])

		const apiModule = await import("../../../api")
		let handlerCreated = false
		let receivedPrompt = ""
		const mockHandler = {
			createMessage: vi.fn().mockImplementation(async function* (systemPrompt: string) {
				handlerCreated = true
				receivedPrompt = systemPrompt
				yield { type: "text", text: "xKiro to enterprise AI gateway..." }
			}),
		}
		vi.spyOn(apiModule, "buildApiHandler").mockImplementation((settings: any) => {
			expect(settings.apiProvider).toBe("xkiro")
			expect(settings.xkiroApiKey).toBe("test-xkiro-key")
			expect(settings.xkiroModelId).toBe("openai/gpt-6.1-sol")
			return mockHandler as any
		})

		const response = await chatManager.sendMessage({
			sessionId: session.id,
			text: "wyszukaj xkiro features",
			webSearchMode: "auto",
		})

		expect(handlerCreated).toBe(true)
		expect(receivedPrompt).toContain("https://xkiro.com/features")
		expect(response.content).toBe("xKiro to enterprise AI gateway...")
	})

	// TEST L — MODEL INDEPENDENCE: Chat web search does not modify global Agent model or reasoning effort
	it("TEST L: Web search preserves independent Chat and Agent models", async () => {
		globalSettingsStore = {
			apiProvider: "anthropic",
			apiModelId: "claude-3-7-sonnet",
			reasoningEffort: "high",
			webSearchEnabled: true,
			webSearchApiKey: "test-brave-key",
		}
		secretStore = {
			xkiroApiKey: "chat-xkiro-key",
			apiKey: "agent-anthropic-key",
			webSearchApiKey: "test-brave-key",
		}

		chatManager = createChatManager()
		const session = await chatManager.createSession({
			title: "Model isolation",
			modelPreference: {
				apiProvider: "xkiro",
				modelId: "openai/gpt-6.1-sol",
				reasoningEffort: "medium",
				webSearchMode: "auto",
			},
		})

		vi.spyOn(WebSearchService.getInstance(), "search").mockResolvedValue([])

		const apiModule = await import("../../../api")
		const mockHandler = {
			createMessage: vi.fn().mockImplementation(async function* () {
				yield { type: "text", text: "ok" }
			}),
		}
		vi.spyOn(apiModule, "buildApiHandler").mockReturnValue(mockHandler as any)

		await chatManager.sendMessage({
			sessionId: session.id,
			text: "wyszukaj test",
			webSearchMode: "auto",
		})

		// Global agent model settings are completely unchanged
		expect(globalSettingsStore.apiProvider).toBe("anthropic")
		expect(globalSettingsStore.apiModelId).toBe("claude-3-7-sonnet")
		expect(globalSettingsStore.reasoningEffort).toBe("high")
	})

	// TEST M — AGENT ISOLATION: Chat search does not leak to Agent execution
	it("TEST M: Chat Web Search is isolated from Agent tool execution", async () => {
		chatManager = createChatManager()
		// Verify ChatSessionManager does not import or expose Agent file writing or terminal tools
		expect((chatManager as any).executeCommand).toBeUndefined()
		expect((chatManager as any).writeToFile).toBeUndefined()
		expect((chatManager as any).askApproval).toBeUndefined()
	})

	// TEST N — STOP GENERATION: Aborting a turn aborts ongoing search and stream
	it("TEST N: abortStream cleanly halts active generation without dangling handles", async () => {
		chatManager = createChatManager()
		const session = await chatManager.createSession({
			title: "Abort test",
			modelPreference: {
				apiProvider: "xkiro",
				modelId: "openai/gpt-6.1-sol",
				webSearchMode: "required",
			},
		})

		vi.spyOn(WebSearchService.getInstance(), "search").mockImplementation(
			() => new Promise((resolve) => setTimeout(() => resolve([]), 500)),
		)

		const apiModule = await import("../../../api")
		const mockHandler = {
			createMessage: vi.fn().mockImplementation(async function* () {
				yield { type: "text", text: "Part 1" }
				await new Promise((resolve) => setTimeout(resolve, 500))
				yield { type: "text", text: "Part 2" }
			}),
		}
		vi.spyOn(apiModule, "buildApiHandler").mockReturnValue(mockHandler as any)

		const sendPromise = chatManager.sendMessage({
			sessionId: session.id,
			text: "wyszukaj coś powoli",
			webSearchMode: "required",
		})

		// Immediately abort
		setTimeout(() => {
			chatManager.abortStream(session.id)
		}, 50)

		const result = await sendPromise
		expect(result.isStreaming).toBe(false)
	})

	// TEST O — SESSION ROUTING: Two concurrent sessions searching different topics do not cross-contaminate
	it("TEST O: Concurrent chat sessions keep separate search queries and results", async () => {
		chatManager = createChatManager()
		const session1 = await chatManager.createSession({
			title: "Topic 1",
			modelPreference: { apiProvider: "xkiro", modelId: "openai/gpt-6.1-sol" },
		})
		const session2 = await chatManager.createSession({
			title: "Topic 2",
			modelPreference: { apiProvider: "xkiro", modelId: "openai/gpt-6.1-sol" },
		})

		vi.spyOn(WebSearchService.getInstance(), "search").mockImplementation(async (query: string) => {
			if (query.includes("python")) {
				return [
					{ title: "Python Info", url: "https://python.org", snippet: "Python language", domain: "python.org" },
				]
			}
			return [
				{ title: "Rust Info", url: "https://rust-lang.org", snippet: "Rust language", domain: "rust-lang.org" },
			]
		})

		const apiModule = await import("../../../api")
		vi.spyOn(apiModule, "buildApiHandler").mockReturnValue({
			createMessage: vi.fn().mockImplementation(async function* (_prompt: string, messages: any[]) {
				const userText = messages[messages.length - 1].content
				yield { type: "text", text: `Response to: ${userText}` }
			}),
		} as any)

		const [res1, res2] = await Promise.all([
			chatManager.sendMessage({
				sessionId: session1.id,
				text: "wyszukaj python",
				webSearchMode: "required",
			}),
			chatManager.sendMessage({
				sessionId: session2.id,
				text: "wyszukaj rust",
				webSearchMode: "required",
			}),
		])

		expect(res1.webSearch?.results[0].domain).toBe("python.org")
		expect(res2.webSearch?.results[0].domain).toBe("rust-lang.org")

		const reloaded1 = await chatManager.getSession(session1.id)
		const reloaded2 = await chatManager.getSession(session2.id)

		expect(reloaded1?.messages[1].webSearch?.results[0].domain).toBe("python.org")
		expect(reloaded2?.messages[1].webSearch?.results[0].domain).toBe("rust-lang.org")
	})

	// TEST P — SESSION RESTORE: Reloading session preserves webSearch metadata and sources
	it("TEST P: Reloading session from disk preserves search queries and sources", async () => {
		chatManager = createChatManager()
		const session = await chatManager.createSession({
			title: "Persistence test",
			modelPreference: { apiProvider: "xkiro", modelId: "openai/gpt-6.1-sol" },
		})

		vi.spyOn(WebSearchService.getInstance(), "search").mockResolvedValue([
			{ title: "Persisted Source", url: "https://persist.example.com", snippet: "Saved data", domain: "persist.example.com" },
		])

		const apiModule = await import("../../../api")
		vi.spyOn(apiModule, "buildApiHandler").mockReturnValue({
			createMessage: vi.fn().mockImplementation(async function* () {
				yield { type: "text", text: "Answer saved" }
			}),
		} as any)

		await chatManager.sendMessage({
			sessionId: session.id,
			text: "wyszukaj persist",
			webSearchMode: "required",
		})

		// Create a brand new manager pointing to the same storageDir to simulate app restart
		const reloadedManager = new ChatSessionManager({
			storageDir: tempDir,
			getGlobalSettings: () => globalSettingsStore,
			getSecret: (key: string) => secretStore[key],
		})

		const restoredSession = await reloadedManager.getSession(session.id)
		expect(restoredSession?.messages.length).toBe(2)
		expect(restoredSession?.messages[1].webSearch).toBeDefined()
		expect(restoredSession?.messages[1].webSearch?.results[0].url).toBe("https://persist.example.com")
	})

	// TEST Q — SEARCH UI & STATUS: Emits search status during active execution
	it("TEST Q: Emits webSearch stream chunk and status during search execution", async () => {
		chatManager = createChatManager()
		const session = await chatManager.createSession({
			title: "UI Status test",
			modelPreference: { apiProvider: "xkiro", modelId: "openai/gpt-6.1-sol" },
		})

		vi.spyOn(WebSearchService.getInstance(), "search").mockResolvedValue([
			{ title: "Chunk Source", url: "https://chunk.example.com", snippet: "Chunk data", domain: "chunk.example.com" },
		])

		const apiModule = await import("../../../api")
		vi.spyOn(apiModule, "buildApiHandler").mockReturnValue({
			createMessage: vi.fn().mockImplementation(async function* () {
				yield { type: "text", text: "Streaming answer" }
			}),
		} as any)

		const emittedChunks: any[] = []
		await chatManager.sendMessage({
			sessionId: session.id,
			text: "wyszukaj chunk test",
			webSearchMode: "required",
			onChunk: (chunk) => emittedChunks.push(chunk),
		})

		// Should emit webSearch chunk
		const searchChunk = emittedChunks.find((c) => c.type === "webSearch")
		expect(searchChunk).toBeDefined()
		expect(searchChunk.search.results[0].title).toBe("Chunk Source")
	})

	// TEST R — PROVIDER AUTHENTICATION REGRESSION: xKiro auth remains intact
	it("TEST R: xKiro authentication resolution is intact without 401 regressions", async () => {
		secretStore["xkiroApiKey"] = "valid-secret-key"
		chatManager = createChatManager()

		const settings = (chatManager as any).buildIsolatedProviderSettings("xkiro", "openai/gpt-6.1-sol")
		expect(settings.xkiroApiKey).toBe("valid-secret-key")
		expect(settings.apiProvider).toBe("xkiro")
	})

	// TEST S — CHAT SIDEBAR REGRESSION: Sidebar preview updates on search and on error
	it("TEST S: Sidebar list preview reflects the latest response after web search", async () => {
		chatManager = createChatManager()
		const session = await chatManager.createSession({
			title: "Sidebar test",
			modelPreference: { apiProvider: "xkiro", modelId: "openai/gpt-6.1-sol" },
		})

		vi.spyOn(WebSearchService.getInstance(), "search").mockResolvedValue([
			{ title: "Sidebar Source", url: "https://sidebar.example.com", snippet: "...", domain: "sidebar.example.com" },
		])

		const apiModule = await import("../../../api")
		vi.spyOn(apiModule, "buildApiHandler").mockReturnValue({
			createMessage: vi.fn().mockImplementation(async function* () {
				yield { type: "text", text: "To jest treść odpowiedzi po wyszukiwaniu." }
			}),
		} as any)

		await chatManager.sendMessage({
			sessionId: session.id,
			text: "wyszukaj sidebar",
			webSearchMode: "required",
		})

		const list = await chatManager.listSessions()
		const summary = list.find((s) => s.id === session.id)
		expect(summary?.lastMessagePreview).toContain("To jest treść odpowiedzi po wyszukiwaniu.")
	})
})
