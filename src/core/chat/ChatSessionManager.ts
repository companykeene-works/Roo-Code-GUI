import fs from "fs"
import path from "path"
import crypto from "crypto"
import { Anthropic } from "@anthropic-ai/sdk"
import {
	type ChatSession,
	type ChatMessage,
	type ChatSessionSummary,
	type ChatModelPreference,
	type ChatPreferences,
	type ChatStreamChunk,
	type ProviderSettings,
	type ProviderName,
	setModelId,
	getModelId,
} from "@roo-code/types"
import { buildApiHandler } from "../../api"
import { defaultResolveModelInfo } from "../config/resolveTaskExecutionConfig"
import { WebSearchService } from "../../services/web-search/WebSearchService"
import { generateChatTitle } from "./title"

export interface ChatSessionManagerOptions {
	storageDir: string
	getGlobalSettings?: () => any
	getSecret?: (key: string) => string | undefined
	saveChatPreferences?: (pref: ChatPreferences) => Promise<void>
	loadChatPreferences?: () => Promise<ChatPreferences | undefined>
}

export class ChatSessionManager {
	private storageDir: string
	private sessionsDir: string
	private indexPath: string
	private activeStreams: Map<string, AbortController> = new Map()
	private getGlobalSettings?: () => any
	private getSecret?: (key: string) => string | undefined
	private saveChatPreferencesCustom?: (pref: ChatPreferences) => Promise<void>
	private loadChatPreferencesCustom?: () => Promise<ChatPreferences | undefined>

	// Lock to serialize disk writes to _index.json
	private indexLock = Promise.resolve()

	constructor(options: ChatSessionManagerOptions) {
		this.storageDir = options.storageDir
		const norm = path.normalize(options.storageDir)
		const isGlobalStorage =
			path.basename(norm).toLowerCase() === "global-storage" ||
			norm.endsWith("global-storage") ||
			norm.endsWith("globalStorage")
		this.sessionsDir = isGlobalStorage
			? path.join(this.storageDir, "chat-sessions")
			: path.join(this.storageDir, "global-storage", "chat-sessions")
		this.indexPath = path.join(this.sessionsDir, "_index.json")
		this.getGlobalSettings = options.getGlobalSettings
		this.getSecret = options.getSecret
		this.saveChatPreferencesCustom = options.saveChatPreferences
		this.loadChatPreferencesCustom = options.loadChatPreferences

		this.ensureDirectory()
	}

	private ensureDirectory(): void {
		try {
			if (!fs.existsSync(this.sessionsDir)) {
				fs.mkdirSync(this.sessionsDir, { recursive: true })
			}
			if (!fs.existsSync(this.indexPath)) {
				fs.writeFileSync(this.indexPath, JSON.stringify({ entries: [] }, null, 2), "utf-8")
			}
		} catch (err) {
			console.error("[ChatSessionManager] Failed to initialize chat sessions directory:", err)
		}
	}

	private runWithIndexLock<T>(fn: () => Promise<T>): Promise<T> {
		const next = this.indexLock.then(fn)
		this.indexLock = next.catch(() => {}) as Promise<void>
		return next
	}

	public async listSessions(): Promise<ChatSessionSummary[]> {
		return this.runWithIndexLock(async () => {
			this.ensureDirectory()
			try {
				if (fs.existsSync(this.indexPath)) {
					const content = fs.readFileSync(this.indexPath, "utf-8")
					const data = JSON.parse(content)
					if (Array.isArray(data?.entries)) {
						return (data.entries as ChatSessionSummary[]).sort((a, b) => b.updatedAt - a.updatedAt)
					}
				}
			} catch (err) {
				console.error("[ChatSessionManager] Error reading session index:", err)
			}
			return []
		})
	}

	public async getSession(id: string): Promise<ChatSession | null> {
		this.ensureDirectory()
		const sessionPath = path.join(this.sessionsDir, `${id}.json`)
		if (!fs.existsSync(sessionPath)) {
			return null
		}
		try {
			const content = fs.readFileSync(sessionPath, "utf-8")
			return JSON.parse(content) as ChatSession
		} catch (err) {
			console.error(`[ChatSessionManager] Error reading session ${id}:`, err)
			return null
		}
	}

	public async createSession(options?: {
		title?: string
		modelPreference?: ChatModelPreference
	}): Promise<ChatSession> {
		const id = crypto.randomUUID()
		const now = Date.now()
		const defaultPreferences = await this.getPreferences()

		const session: ChatSession = {
			id,
			title: options?.title || "New Chat",
			titleSource: options?.title ? "manual" : "initial",
			createdAt: now,
			updatedAt: now,
			modelPreference: options?.modelPreference || {
				apiProvider: defaultPreferences.apiProvider,
				modelId: defaultPreferences.modelId,
				reasoningEffort: defaultPreferences.reasoningEffort,
				webSearchMode: defaultPreferences.webSearchMode,
			},
			messages: [],
		}

		await this.saveSession(session)
		return session
	}

	public async saveSession(session: ChatSession): Promise<void> {
		this.ensureDirectory()
		const sessionPath = path.join(this.sessionsDir, `${session.id}.json`)
		fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2), "utf-8")

		await this.runWithIndexLock(async () => {
			let entries: ChatSessionSummary[] = []
			try {
				if (fs.existsSync(this.indexPath)) {
					const content = fs.readFileSync(this.indexPath, "utf-8")
					const data = JSON.parse(content)
					if (Array.isArray(data?.entries)) {
						entries = data.entries
					}
				}
			} catch {}

			const lastMsg = session.messages[session.messages.length - 1]
			const summary: ChatSessionSummary = {
				id: session.id,
				title: session.title,
				createdAt: session.createdAt,
				updatedAt: session.updatedAt,
				messageCount: session.messages.length,
				lastMessagePreview: lastMsg?.content ? lastMsg.content.slice(0, 100) : undefined,
				modelPreference: session.modelPreference,
			}

			const existingIndex = entries.findIndex((e) => e.id === session.id)
			if (existingIndex >= 0) {
				entries[existingIndex] = summary
			} else {
				entries.unshift(summary)
			}

			fs.writeFileSync(this.indexPath, JSON.stringify({ entries }, null, 2), "utf-8")
		})
	}

	public async deleteSession(id: string): Promise<boolean> {
		this.abortStream(id)
		this.ensureDirectory()
		const sessionPath = path.join(this.sessionsDir, `${id}.json`)
		if (fs.existsSync(sessionPath)) {
			try {
				fs.unlinkSync(sessionPath)
			} catch (err) {
				console.error(`[ChatSessionManager] Failed to delete session file ${id}:`, err)
			}
		}

		return this.runWithIndexLock(async () => {
			try {
				if (fs.existsSync(this.indexPath)) {
					const content = fs.readFileSync(this.indexPath, "utf-8")
					const data = JSON.parse(content)
					if (Array.isArray(data?.entries)) {
						const filtered = (data.entries as ChatSessionSummary[]).filter((e) => e.id !== id)
						fs.writeFileSync(this.indexPath, JSON.stringify({ entries: filtered }, null, 2), "utf-8")
						return true
					}
				}
			} catch {}
			return false
		})
	}

	public async renameSession(id: string, newTitle: string): Promise<boolean> {
		const session = await this.getSession(id)
		if (!session) return false

		session.title = newTitle.trim() || "Untitled Chat"
		session.titleSource = "manual"
		session.updatedAt = Date.now()
		await this.saveSession(session)
		return true
	}

	public async saveDraft(
		id: string,
		draft: { text: string; images?: string[]; webSearchMode?: "off" | "auto" | "required" },
	): Promise<void> {
		const session = await this.getSession(id)
		if (!session) return
		session.draft = draft
		const sessionPath = path.join(this.sessionsDir, `${id}.json`)
		fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2), "utf-8")
	}

	public async getPreferences(): Promise<ChatPreferences> {
		if (this.loadChatPreferencesCustom) {
			try {
				const custom = await this.loadChatPreferencesCustom()
				if (custom && custom.apiProvider) return custom
			} catch {}
		}

		const prefPath = path.join(this.sessionsDir, "preferences.json")
		if (fs.existsSync(prefPath)) {
			try {
				const content = fs.readFileSync(prefPath, "utf-8")
				return JSON.parse(content) as ChatPreferences
			} catch {}
		}

		// Initial safe default if never configured before
		const globalSettings = this.getGlobalSettings ? this.getGlobalSettings() : {}
		const defaultProvider = globalSettings?.apiProvider || "xkiro"
		const defaultModel = defaultProvider === "xkiro" ? "openai/gpt-5.6-terra" : "openrouter/auto"

		const initialPref: ChatPreferences = {
			apiProvider: defaultProvider,
			modelId: defaultModel,
			reasoningEffort: "medium",
			webSearchMode: "auto",
			enabled: true,
		}

		await this.savePreferences(initialPref)
		return initialPref
	}

	public async savePreferences(preferences: ChatPreferences): Promise<void> {
		this.ensureDirectory()
		const prefPath = path.join(this.sessionsDir, "preferences.json")
		fs.writeFileSync(prefPath, JSON.stringify(preferences, null, 2), "utf-8")
		if (this.saveChatPreferencesCustom) {
			try {
				await this.saveChatPreferencesCustom(preferences)
			} catch (e) {
				console.warn("[ChatSessionManager] Custom saveChatPreferences failed:", e)
			}
		}
	}

	public abortStream(sessionId: string): void {
		const controller = this.activeStreams.get(sessionId)
		if (controller) {
			controller.abort()
			this.activeStreams.delete(sessionId)
		}
	}

	public isStreaming(sessionId: string): boolean {
		return this.activeStreams.has(sessionId)
	}

	/**
	 * Sends a message in a session, streaming the response.
	 */
	public async sendMessage(params: {
		sessionId: string
		text: string
		images?: string[]
		webSearchMode?: "off" | "auto" | "required"
		onChunk?: (chunk: ChatStreamChunk) => void
	}): Promise<ChatMessage> {
		const { sessionId, text, images, onChunk } = params
		const session = await this.getSession(sessionId)
		if (!session) {
			throw new Error(`Session ${sessionId} not found`)
		}

		// Cancel any existing stream for this session
		this.abortStream(sessionId)

		const abortController = new AbortController()
		this.activeStreams.set(sessionId, abortController)

		const now = Date.now()
		const userMessage: ChatMessage = {
			id: crypto.randomUUID(),
			role: "user",
			content: text,
			images,
			timestamp: now,
		}

		session.messages.push(userMessage)
		// Clear saved draft since message is being sent
		session.draft = undefined
		session.updatedAt = now

		// Auto title if first user turn and title was not set manually
		if (session.messages.filter((m) => m.role === "user").length === 1 && session.titleSource !== "manual") {
			session.title = generateChatTitle(text)
			session.titleSource = "auto"
		}

		const assistantMessage: ChatMessage = {
			id: crypto.randomUUID(),
			role: "assistant",
			content: "",
			timestamp: now + 1,
			isStreaming: true,
		}
		session.messages.push(assistantMessage)
		await this.saveSession(session)

		try {
			// Resolve provider settings
			const preferences = await this.getPreferences()
			const targetProvider = (session.modelPreference?.apiProvider || preferences.apiProvider || "xkiro") as ProviderName
			const targetModelId = session.modelPreference?.modelId || preferences.modelId || "openai/gpt-5.6-terra"
			const targetReasoningEffort = session.modelPreference?.reasoningEffort || preferences.reasoningEffort
			const effectiveWebSearchMode = params.webSearchMode || session.modelPreference?.webSearchMode || preferences.webSearchMode || "auto"

			const providerSettings = this.buildIsolatedProviderSettings(targetProvider, targetModelId, targetReasoningEffort)
			const apiHandler = buildApiHandler(providerSettings)

			// Web Search grounding
			let searchContext = ""
			if (effectiveWebSearchMode === "required" || (effectiveWebSearchMode === "auto" && this.shouldTriggerSearch(text))) {
				try {
					const webSearchService = WebSearchService.getInstance()
					const globalSettings = this.getGlobalSettings ? this.getGlobalSettings() : {}
					const searchConfig = {
						enabled: globalSettings?.webSearchEnabled ?? true,
						provider: globalSettings?.webSearchProvider ?? "brave",
						apiKey: this.getSecret ? this.getSecret("webSearchApiKey") : undefined,
						searxngUrl: globalSettings?.webSearchSearxngUrl ?? "",
						maxResults: globalSettings?.webSearchMaxResults ?? 5,
					}

					if (webSearchService.isConfigured(searchConfig)) {
						const searchQuery = this.extractSearchQuery(text)
						const searchResults = await webSearchService.search(searchQuery, searchConfig)
						if (searchResults && searchResults.length > 0) {
							assistantMessage.webSearch = {
								query: searchQuery,
								results: searchResults.map((r) => ({
									title: r.title,
									url: r.url,
									snippet: r.snippet,
								})),
							}
							onChunk?.({ type: "webSearch", search: assistantMessage.webSearch })

							searchContext = `\n\n[Web Search Results for: "${searchQuery}"]\n` +
								searchResults.map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.snippet}`).join("\n\n")
						}
					}
				} catch (searchErr) {
					console.warn("[ChatSessionManager] Web search execution error:", searchErr)
				}
			}

			// Format messages for ApiHandler
			const systemPrompt =
				"You are a helpful, brilliant, concise, and accurate AI programming and general assistant in Roo Code GUI. " +
				"Answer the user's questions clearly, accurately, and thoughtfully. Use Markdown for formatting code, lists, and tables." +
				(searchContext ? `\n\nReference the following web search information if relevant:\n${searchContext}` : "")

			const anthropicMessages = this.formatMessagesForApi(session.messages.slice(0, -1))

			const stream = apiHandler.createMessage(systemPrompt, anthropicMessages, {
				taskId: `chat-${sessionId}`,
				mode: "chat",
				signal: abortController.signal,
			})

			for await (const chunk of stream) {
				if (abortController.signal.aborted) {
					break
				}

				if (chunk.type === "text") {
					assistantMessage.content += chunk.text
					onChunk?.({ type: "text", text: chunk.text })
				} else if (chunk.type === "reasoning") {
					assistantMessage.reasoning = (assistantMessage.reasoning || "") + chunk.text
					onChunk?.({ type: "reasoning", text: chunk.text })
				} else if (chunk.type === "usage") {
					assistantMessage.tokenUsage = {
						promptTokens: chunk.inputTokens,
						completionTokens: chunk.outputTokens,
						totalTokens: (chunk.inputTokens || 0) + (chunk.outputTokens || 0),
					}
					onChunk?.({
						type: "usage",
						usage: assistantMessage.tokenUsage,
					})
				} else if (chunk.type === "error") {
					assistantMessage.error = chunk.message
					onChunk?.({ type: "error", error: chunk.message })
				}
			}
		} catch (error: any) {
			if (abortController.signal.aborted) {
				// Aborted by user - preserve partial output cleanly
			} else {
				const errMsg = error?.message || String(error)
				assistantMessage.error = errMsg
				onChunk?.({ type: "error", error: errMsg })
			}
		} finally {
			this.activeStreams.delete(sessionId)
			assistantMessage.isStreaming = false
			session.updatedAt = Date.now()
			await this.saveSession(session)
			onChunk?.({ type: "complete", messageId: assistantMessage.id })
		}

		return assistantMessage
	}

	public async editMessageAndRegenerate(params: {
		sessionId: string
		messageId: string
		newText: string
		images?: string[]
		webSearchMode?: "off" | "auto" | "required"
		onChunk?: (chunk: ChatStreamChunk) => void
	}): Promise<ChatMessage> {
		const session = await this.getSession(params.sessionId)
		if (!session) throw new Error("Session not found")

		const index = session.messages.findIndex((m) => m.id === params.messageId)
		if (index < 0) throw new Error("Message not found")

		// Truncate everything after this message to create a clean branch
		session.messages = session.messages.slice(0, index)
		await this.saveSession(session)

		return this.sendMessage({
			sessionId: params.sessionId,
			text: params.newText,
			images: params.images,
			webSearchMode: params.webSearchMode,
			onChunk: params.onChunk,
		})
	}

	public async regenerateResponse(params: {
		sessionId: string
		assistantMessageId: string
		onChunk?: (chunk: ChatStreamChunk) => void
	}): Promise<ChatMessage> {
		const session = await this.getSession(params.sessionId)
		if (!session) throw new Error("Session not found")

		const index = session.messages.findIndex((m) => m.id === params.assistantMessageId)
		if (index <= 0) throw new Error("Assistant message not found or has no preceding prompt")

		const userMsg = session.messages[index - 1]
		if (userMsg.role !== "user") throw new Error("Preceding message is not user message")

		// Truncate from the assistant message onward
		session.messages = session.messages.slice(0, index - 1)
		await this.saveSession(session)

		return this.sendMessage({
			sessionId: params.sessionId,
			text: userMsg.content,
			images: userMsg.images,
			onChunk: params.onChunk,
		})
	}

	private buildIsolatedProviderSettings(
		provider: ProviderName,
		modelId: string,
		reasoningEffort?: string,
	): ProviderSettings {
		const globalSettings = this.getGlobalSettings ? this.getGlobalSettings() : {}
		const settings: ProviderSettings = {
			apiProvider: provider,
		}

		// Inject credentials for the target provider without modifying global settings
		if (provider === "xkiro") {
			settings.xkiroApiKey = this.getSecret?.("xkiroApiKey") || globalSettings.xkiroApiKey
		} else if (provider === "openrouter") {
			settings.openRouterApiKey = this.getSecret?.("openRouterApiKey") || globalSettings.openRouterApiKey
		} else if (provider === "anthropic") {
			settings.apiKey = this.getSecret?.("apiKey") || globalSettings.apiKey
		} else if (provider === "openai-native") {
			settings.openAiNativeApiKey = this.getSecret?.("openAiNativeApiKey") || globalSettings.openAiNativeApiKey
		} else if (provider === "deepseek") {
			settings.deepSeekApiKey = this.getSecret?.("deepSeekApiKey") || globalSettings.deepSeekApiKey
		} else if (provider === "gemini") {
			settings.geminiApiKey = this.getSecret?.("geminiApiKey") || globalSettings.geminiApiKey
		} else {
			// Generic fallback
			settings.apiKey = this.getSecret?.("apiKey") || globalSettings.apiKey
		}

		setModelId(settings, provider, modelId)
		if (reasoningEffort) {
			settings.reasoningEffort = reasoningEffort as any
		}

		const modelInfo = defaultResolveModelInfo(modelId)
		if (modelInfo) {
			if (provider === "xkiro") {
				settings.xkiroCustomModelInfo = modelInfo
			} else if (provider === "openai" || provider === "openai-native") {
				settings.openAiCustomModelInfo = modelInfo
			}
		}

		return settings
	}

	public async regenerateMessage(params: {
		sessionId: string
		messageId: string
		onChunk?: (chunk: ChatStreamChunk) => void
	}): Promise<ChatMessage> {
		return this.regenerateResponse({
			sessionId: params.sessionId,
			assistantMessageId: params.messageId,
			onChunk: params.onChunk,
		})
	}

	private shouldTriggerSearch(text: string): boolean {
		const lower = text.toLowerCase()
		return (
			lower.includes("wyszukaj") ||
			lower.includes("sprawdź w internecie") ||
			lower.includes("search online") ||
			lower.includes("search the web") ||
			lower.includes("latest news") ||
			lower.includes("co nowego") ||
			lower.includes("changelog") ||
			lower.includes("release notes") ||
			lower.startsWith("/web ")
		)
	}

	private extractSearchQuery(text: string): string {
		let cleaned = text.replace(/^\/web\s+/i, "").trim()
		const match = cleaned.match(/(?:wyszukaj|search the web for|search for|look up)\s+(.+)/i)
		if (match && match[1]) {
			return match[1].trim()
		}
		return cleaned.slice(0, 100)
	}

	private formatMessagesForApi(messages: ChatMessage[]): Anthropic.Messages.MessageParam[] {
		const result: Anthropic.Messages.MessageParam[] = []

		for (const msg of messages) {
			if (msg.role === "user") {
				if (msg.images && msg.images.length > 0) {
					const content: Anthropic.Messages.ContentBlockParam[] = []
					for (const img of msg.images) {
						const match = img.match(/^data:image\/([a-zA-Z]+);base64,(.+)$/)
						if (match) {
							content.push({
								type: "image",
								source: {
									type: "base64",
									media_type: `image/${match[1]}` as any,
									data: match[2],
								},
							})
						}
					}
					content.push({
						type: "text",
						text: msg.content,
					})
					result.push({ role: "user", content })
				} else {
					result.push({ role: "user", content: msg.content })
				}
			} else if (msg.role === "assistant") {
				if (msg.content) {
					result.push({ role: "assistant", content: msg.content })
				}
			}
		}

		return result
	}
}
