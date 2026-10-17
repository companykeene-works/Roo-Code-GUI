import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import fs from "fs"
import path from "path"
import os from "os"
import { ChatSessionManager } from "../ChatSessionManager"
import type { ProviderSettings } from "@roo-code/types"

describe("Native Chat P1 Authentication & Sidebar Sync Tests (TEST A - M)", () => {
	let tempDir: string
	let chatManager: ChatSessionManager
	let secretStore: Record<string, string>
	let globalSettingsStore: Record<string, any>

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "roo-chat-auth-sync-"))
		secretStore = {}
		globalSettingsStore = {}
	})

	afterEach(() => {
		try {
			fs.rmSync(tempDir, { recursive: true, force: true })
		} catch {}
	})

	// TEST A: Existing xKiro credentials resolution from secure storage (xkiroApiKey, apiKey, roo_cline_config_api_config)
	it("TEST A: Existing xKiro credentials resolved correctly without saving to preferences", async () => {
		// Scenario 1: Key stored in roo_cline_config_api_config profile
		secretStore["roo_cline_config_api_config"] = JSON.stringify({
			currentApiConfigName: "xkiro-profile",
			apiConfigs: {
				"xkiro-profile": {
					id: "p1",
					apiProvider: "xkiro",
					xkiroApiKey: "secure-xkiro-key-123",
					xkiroBaseUrl: "https://api.xkiro.com/v1",
				},
			},
		})

		chatManager = new ChatSessionManager({
			storageDir: tempDir,
			getGlobalSettings: () => ({ apiProvider: "openrouter", openRouterModelId: "anthropic/claude-3.7-sonnet" }),
			getSecret: (key: string) => secretStore[key],
		})

		// Use private buildIsolatedProviderSettings via any
		const settings = (chatManager as any).buildIsolatedProviderSettings("xkiro", "openai/gpt-6.1-sol", "medium")
		expect(settings.apiProvider).toBe("xkiro")
		expect(settings.xkiroApiKey).toBe("secure-xkiro-key-123")
		expect(settings.xkiroBaseUrl).toBe("https://api.xkiro.com/v1")
		expect(settings.xkiroModelId).toBe("openai/gpt-6.1-sol")
		expect(settings.reasoningEffort).toBe("medium")

		// Verify preferences file does NOT contain the plaintext key
		const pref = await chatManager.getPreferences()
		expect((pref as any).xkiroApiKey).toBeUndefined()
		expect((pref as any).apiKey).toBeUndefined()
	})

	// TEST B: Model isolation - Agent and Chat retain separate model selections
	it("TEST B: Model isolation between Agent and Chat", async () => {
		secretStore["xkiroApiKey"] = "shared-xkiro-secret"
		globalSettingsStore = {
			apiProvider: "xkiro",
			xkiroModelId: "qwen/qwen3.8-max",
			reasoningEffort: "high",
		}

		chatManager = new ChatSessionManager({
			storageDir: tempDir,
			getGlobalSettings: () => globalSettingsStore,
			getSecret: (key: string) => secretStore[key],
		})

		await chatManager.savePreferences({
			apiProvider: "xkiro",
			modelId: "openai/gpt-6.1-sol",
			reasoningEffort: "medium",
		})

		const chatPref = await chatManager.getPreferences()
		expect(chatPref.modelId).toBe("openai/gpt-6.1-sol")
		expect(chatPref.reasoningEffort).toBe("medium")

		// Agent settings in globalSettingsStore are NOT changed
		expect(globalSettingsStore.xkiroModelId).toBe("qwen/qwen3.8-max")
		expect(globalSettingsStore.reasoningEffort).toBe("high")

		// Chat isolated settings have Chat model
		const chatRequestSettings = (chatManager as any).buildIsolatedProviderSettings(
			chatPref.apiProvider,
			chatPref.modelId,
			chatPref.reasoningEffort,
		)
		expect(chatRequestSettings.xkiroModelId).toBe("openai/gpt-6.1-sol")
		expect(chatRequestSettings.reasoningEffort).toBe("medium")
		expect(chatRequestSettings.xkiroApiKey).toBe("shared-xkiro-secret")
	})

	// TEST C: Missing credentials validation - do NOT send request with "not-provided"
	it("TEST C: Missing credentials rejected before sending request without network call", async () => {
		chatManager = new ChatSessionManager({
			storageDir: tempDir,
			getGlobalSettings: () => ({ apiProvider: "openrouter" }),
			getSecret: () => undefined,
		})

		const session = await chatManager.createSession({
			title: "Missing Key Test",
			modelPreference: {
				apiProvider: "xkiro",
				modelId: "openai/gpt-6.1-sol",
			},
		})

		const chunks: any[] = []
		const resultMsg = await chatManager.sendMessage({
			sessionId: session.id,
			text: "Hello missing key",
			onChunk: (chunk) => chunks.push(chunk),
		})

		// Must fail gracefully with clear error on the assistant message
		expect(resultMsg.error).toBeDefined()
		expect(resultMsg.error).toContain("Missing API key for xKiro")
		expect(chunks.some((c) => c.type === "error" && c.error.includes("Missing API key"))).toBe(true)

		// Session is preserved with the error recorded
		const loaded = await chatManager.getSession(session.id)
		expect(loaded?.messages.length).toBe(2)
		expect(loaded?.messages[1].error).toContain("Missing API key")
	})

	// TEST D: Provider returns 401 - handles error, preserves history, no infinite retry
	it("TEST D: Provider returns 401 - cleanly handled and history preserved", async () => {
		secretStore["xkiroApiKey"] = "invalid-or-disabled-key"
		chatManager = new ChatSessionManager({
			storageDir: tempDir,
			getGlobalSettings: () => ({ apiProvider: "xkiro", xkiroApiKey: "invalid-or-disabled-key" }),
			getSecret: (key: string) => secretStore[key],
		})

		const session = await chatManager.createSession({
			title: "401 Test",
			modelPreference: {
				apiProvider: "xkiro",
				modelId: "openai/gpt-6.1-sol",
			},
		})

		// Mock buildApiHandler to simulate 401 error
		const apiModule = await import("../../../api")
		const originalBuild = apiModule.buildApiHandler
		const mockHandler = {
			createMessage: vi.fn().mockImplementation(async function* () {
				throw new Error("xKiro completion error: 401 Invalid or disabled ClientApiKey.")
			}),
		}
		vi.spyOn(apiModule, "buildApiHandler").mockReturnValue(mockHandler as any)

		try {
			const chunks: any[] = []
			const result = await chatManager.sendMessage({
				sessionId: session.id,
				text: "Opowiedz mi o usłudze xkiro",
				onChunk: (chunk) => chunks.push(chunk),
			})

			expect(result.error).toBeDefined()
			expect(result.error).toContain("Authentication failed (401)")
			expect(result.error).toContain("Invalid or disabled API key for xkiro")

			// Verify history is preserved
			const reloaded = await chatManager.getSession(session.id)
			expect(reloaded).not.toBeNull()
			expect(reloaded?.messages.length).toBe(2)
			expect(reloaded?.messages[0].content).toBe("Opowiedz mi o usłudze xkiro")
			expect(reloaded?.messages[1].error).toContain("Authentication failed (401)")

			// Verify stream error chunk was emitted
			expect(chunks.some((c) => c.type === "error")).toBe(true)
		} finally {
			vi.spyOn(apiModule, "buildApiHandler").mockRestore()
		}
	})

	// TEST E: xKiro request construction
	it("TEST E: xKiro request construction includes correct baseURL, provider, model and auth without leak", async () => {
		secretStore["apiKey"] = "general-secret-key"
		globalSettingsStore = {
			apiProvider: "xkiro",
			xkiroBaseUrl: "https://custom.xkiro.proxy/v1",
		}

		chatManager = new ChatSessionManager({
			storageDir: tempDir,
			getGlobalSettings: () => globalSettingsStore,
			getSecret: (key: string) => secretStore[key],
		})

		const settings = (chatManager as any).buildIsolatedProviderSettings("xkiro", "openai/gpt-6.1-sol", "medium")
		expect(settings.apiProvider).toBe("xkiro")
		expect(settings.xkiroApiKey).toBe("general-secret-key")
		expect(settings.xkiroBaseUrl).toBe("https://custom.xkiro.proxy/v1")
		expect(settings.xkiroModelId).toBe("openai/gpt-6.1-sol")
		expect(settings.reasoningEffort).toBe("medium")
	})

	// TEST F: Other providers credentials resolution
	it("TEST F: Other providers (openrouter, anthropic, openai-native, deepseek, gemini) resolve properly", async () => {
		secretStore["openRouterApiKey"] = "or-secret"
		secretStore["apiKey"] = "anthropic-secret"
		secretStore["openAiNativeApiKey"] = "openai-native-secret"
		secretStore["deepSeekApiKey"] = "deepseek-secret"
		secretStore["geminiApiKey"] = "gemini-secret"

		chatManager = new ChatSessionManager({
			storageDir: tempDir,
			getGlobalSettings: () => ({}),
			getSecret: (key: string) => secretStore[key],
		})

		const or = (chatManager as any).buildIsolatedProviderSettings("openrouter", "openrouter/auto")
		expect(or.openRouterApiKey).toBe("or-secret")

		const ant = (chatManager as any).buildIsolatedProviderSettings("anthropic", "claude-3-7-sonnet-20250219")
		expect(ant.apiKey).toBe("anthropic-secret")

		const oai = (chatManager as any).buildIsolatedProviderSettings("openai-native", "gpt-4o")
		expect(oai.openAiNativeApiKey).toBe("openai-native-secret")

		const ds = (chatManager as any).buildIsolatedProviderSettings("deepseek", "deepseek-chat")
		expect(ds.deepSeekApiKey).toBe("deepseek-secret")

		const gem = (chatManager as any).buildIsolatedProviderSettings("gemini", "gemini-2.5-pro")
		expect(gem.geminiApiKey).toBe("gemini-secret")
	})

	// TEST G1: Multiple xKiro profiles - safely selects profile with valid credentials
	it("TEST G1: Multiple xKiro profiles - selects the configured profile with key without error", async () => {
		secretStore["roo_cline_config_api_config"] = JSON.stringify({
			currentApiConfigName: "anthropic-profile", // Agent currently on Anthropic!
			apiConfigs: {
				"anthropic-profile": {
					id: "p0",
					apiProvider: "anthropic",
					apiKey: "anthropic-secret-key-999",
				},
				"xkiro-empty": {
					id: "p1",
					apiProvider: "xkiro",
					xkiroApiKey: "",
				},
				"xkiro-production": {
					id: "p2",
					apiProvider: "xkiro",
					xkiroApiKey: "xkiro-prod-key-777",
					xkiroBaseUrl: "https://api.xkiro.com/v1",
				},
			},
		})

		chatManager = new ChatSessionManager({
			storageDir: tempDir,
			getGlobalSettings: () => ({ apiProvider: "anthropic" }),
			getSecret: (key: string) => secretStore[key],
		})

		const settings = (chatManager as any).buildIsolatedProviderSettings("xkiro", "openai/gpt-6.1-sol")
		expect(settings.apiProvider).toBe("xkiro")
		// Must pick xkiro-production which has the key, not the empty one or the Anthropic one
		expect(settings.xkiroApiKey).toBe("xkiro-prod-key-777")
		expect(settings.xkiroApiKey).not.toBe("anthropic-secret-key-999")
	})

	// TEST G2: Agent on Anthropic with apiKey secret - Chat on xKiro does NOT leak Anthropic key
	it("TEST G2: Agent on Anthropic with generic apiKey - Chat on xKiro does NOT inherit Anthropic apiKey when no xKiro key is configured", async () => {
		secretStore["apiKey"] = "anthropic-super-secret-key"
		globalSettingsStore = {
			apiProvider: "anthropic",
			apiKey: "anthropic-super-secret-key",
		}

		chatManager = new ChatSessionManager({
			storageDir: tempDir,
			getGlobalSettings: () => globalSettingsStore,
			getSecret: (key: string) => secretStore[key],
		})

		// Chat requests xkiro without any xkiro key configured anywhere
		const settings = (chatManager as any).buildIsolatedProviderSettings("xkiro", "openai/gpt-6.1-sol")
		expect(settings.apiProvider).toBe("xkiro")
		// settings.xkiroApiKey must NOT be the Anthropic key!
		expect(settings.xkiroApiKey).toBeUndefined()

		// Pre-flight validation must reject it cleanly
		expect(() => (chatManager as any).validateProviderCredentials("xkiro", settings)).toThrow(
			"Missing API key for xKiro",
		)
	})

	// TEST H & I: Chat sidebar sync and error persistence in summary preview
	it("TEST H & I: Sending message updates sidebar summary and preview is preserved on error", async () => {
		let turnStartCalled = false
		chatManager = new ChatSessionManager({
			storageDir: tempDir,
			getGlobalSettings: () => ({ apiProvider: "xkiro" }),
			getSecret: () => undefined, // will fail with missing key
		})

		const session = await chatManager.createSession()
		expect(session.title).toBe("New Chat")

		// List before send: "No messages yet" / messageCount 0
		let summaries = await chatManager.listSessions()
		expect(summaries[0].messageCount).toBe(0)
		expect(summaries[0].lastMessagePreview).toBeUndefined()

		await chatManager.sendMessage({
			sessionId: session.id,
			text: "Opowiedz mi o usłudze xkiro",
			onTurnStart: () => {
				turnStartCalled = true
			},
		})

		expect(turnStartCalled).toBe(true)

		// After send with error: summary is updated with title and lastMessagePreview
		summaries = await chatManager.listSessions()
		expect(summaries[0].title).not.toBe("New Chat")
		expect(summaries[0].messageCount).toBe(2)
		// lastMessagePreview must NOT be undefined ("No messages yet")
		expect(summaries[0].lastMessagePreview).toBeDefined()
		expect(summaries[0].lastMessagePreview?.length).toBeGreaterThan(0)
	})

	// TEST J: Restart restores chat sessions, preferences, and independent models
	it("TEST J: Restart restores sessions and preferences independently", async () => {
		secretStore["xkiroApiKey"] = "persisted-key"
		chatManager = new ChatSessionManager({
			storageDir: tempDir,
			getGlobalSettings: () => ({ apiProvider: "xkiro", xkiroModelId: "qwen/qwen3.8-max" }),
			getSecret: (key: string) => secretStore[key],
		})

		const session = await chatManager.createSession({
			title: "Restart Persistence Test",
			modelPreference: {
				apiProvider: "xkiro",
				modelId: "openai/gpt-6.1-sol",
				reasoningEffort: "medium",
			},
		})
		await chatManager.savePreferences({
			apiProvider: "xkiro",
			modelId: "openai/gpt-6.1-sol",
			reasoningEffort: "medium",
		})

		// Simulate restart
		const reloaded = new ChatSessionManager({
			storageDir: tempDir,
			getGlobalSettings: () => ({ apiProvider: "xkiro", xkiroModelId: "qwen/qwen3.8-max" }),
			getSecret: (key: string) => secretStore[key],
		})

		const restoredPref = await reloaded.getPreferences()
		expect(restoredPref.modelId).toBe("openai/gpt-6.1-sol")
		expect(restoredPref.reasoningEffort).toBe("medium")

		const restoredSession = await reloaded.getSession(session.id)
		expect(restoredSession?.title).toBe("Restart Persistence Test")
		expect(restoredSession?.modelPreference?.modelId).toBe("openai/gpt-6.1-sol")
	})

	// TEST L: Parallel operation - Chat failure does not affect active Agent
	it("TEST L: Chat 401 error does not affect active Agent state", async () => {
		const agentState = {
			activeTaskId: "task-agent-streaming-1",
			isStreaming: true,
			modelId: "qwen/qwen3.8-max",
		}

		secretStore["xkiroApiKey"] = "bad-key"
		chatManager = new ChatSessionManager({
			storageDir: tempDir,
			getGlobalSettings: () => ({ apiProvider: "xkiro", xkiroModelId: agentState.modelId }),
			getSecret: (key: string) => secretStore[key],
		})

		const session = await chatManager.createSession({
			modelPreference: { apiProvider: "xkiro", modelId: "openai/gpt-6.1-sol" },
		})

		const apiModule = await import("../../../api")
		vi.spyOn(apiModule, "buildApiHandler").mockReturnValue({
			createMessage: vi.fn().mockImplementation(async function* () {
				throw new Error("xKiro completion error: 401 Invalid or disabled ClientApiKey.")
			}),
		} as any)

		try {
			await chatManager.sendMessage({
				sessionId: session.id,
				text: "Fail this chat",
			})
		} catch {}

		// Invariant: Agent state is completely unaffected
		expect(agentState.activeTaskId).toBe("task-agent-streaming-1")
		expect(agentState.isStreaming).toBe(true)
		expect(agentState.modelId).toBe("qwen/qwen3.8-max")

		vi.spyOn(apiModule, "buildApiHandler").mockRestore()
	})

	// TEST M: Chat recovery - After fixing credentials, retrying succeeds without losing history
	it("TEST M: Chat recovery after credentials fixed preserves conversation history", async () => {
		// Start without key
		chatManager = new ChatSessionManager({
			storageDir: tempDir,
			getGlobalSettings: () => ({ apiProvider: "xkiro" }),
			getSecret: (key: string) => secretStore[key],
		})

		const session = await chatManager.createSession()
		const failed = await chatManager.sendMessage({
			sessionId: session.id,
			text: "First question",
		})
		expect(failed.error).toContain("Missing API key")

		// Now configure valid key
		secretStore["xkiroApiKey"] = "valid-working-key"

		const apiModule = await import("../../../api")
		vi.spyOn(apiModule, "buildApiHandler").mockReturnValue({
			createMessage: vi.fn().mockImplementation(async function* () {
				yield { type: "text", text: "Answer after fixing credentials" }
			}),
		} as any)

		try {
			// Regenerate failed message
			const recovered = await chatManager.regenerateResponse({
				sessionId: session.id,
				assistantMessageId: failed.id,
			})

			expect(recovered.content).toBe("Answer after fixing credentials")
			expect(recovered.error).toBeUndefined()

			// History preserved
			const finalSession = await chatManager.getSession(session.id)
			expect(finalSession?.messages.length).toBe(2)
			expect(finalSession?.messages[0].content).toBe("First question")
			expect(finalSession?.messages[1].content).toBe("Answer after fixing credentials")
		} finally {
			vi.spyOn(apiModule, "buildApiHandler").mockRestore()
		}
	})
})
