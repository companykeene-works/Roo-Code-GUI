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
	getProviderProfiles?: () => any
	saveChatPreferences?: (pref: ChatPreferences) => Promise<void>
	loadChatPreferences?: () => Promise<ChatPreferences | undefined>
	onSessionSaved?: (session: ChatSession, summaries: ChatSessionSummary[]) => void | Promise<void>
	onTurnStart?: (session: ChatSession) => void | Promise<void>
}

export class ChatSessionManager {
	private storageDir: string
	private sessionsDir: string
	private indexPath: string
	private activeStreams: Map<string, AbortController> = new Map()
	private getGlobalSettings?: () => any
	private getSecret?: (key: string) => string | undefined
	private getProviderProfiles?: () => any
	private saveChatPreferencesCustom?: (pref: ChatPreferences) => Promise<void>
	private loadChatPreferencesCustom?: () => Promise<ChatPreferences | undefined>
	private onSessionSaved?: (session: ChatSession, summaries: ChatSessionSummary[]) => void | Promise<void>
	private onTurnStart?: (session: ChatSession) => void | Promise<void>

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
		this.getProviderProfiles = options.getProviderProfiles
		this.saveChatPreferencesCustom = options.saveChatPreferences
		this.loadChatPreferencesCustom = options.loadChatPreferences
		this.onSessionSaved = options.onSessionSaved
		this.onTurnStart = options.onTurnStart

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

			let lastMessagePreview: string | undefined = undefined
			for (let i = session.messages.length - 1; i >= 0; i--) {
				const m = session.messages[i]
				if (m.content && m.content.trim().length > 0) {
					lastMessagePreview = m.content.trim().slice(0, 100)
					break
				}
				if (m.error && m.error.trim().length > 0) {
					lastMessagePreview = m.error.trim().slice(0, 100)
					break
				}
			}

			const summary: ChatSessionSummary = {
				id: session.id,
				title: session.title,
				createdAt: session.createdAt,
				updatedAt: session.updatedAt,
				messageCount: session.messages.length,
				lastMessagePreview,
				modelPreference: session.modelPreference,
			}

			const existingIndex = entries.findIndex((e) => e.id === session.id)
			if (existingIndex >= 0) {
				entries[existingIndex] = summary
			} else {
				entries.unshift(summary)
			}

			fs.writeFileSync(this.indexPath, JSON.stringify({ entries }, null, 2), "utf-8")

			try {
				this.onSessionSaved?.(session, entries)
			} catch (err) {
				console.warn("[ChatSessionManager] onSessionSaved hook error:", err)
			}
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
		onTurnStart?: () => void
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
			params.onTurnStart?.()
			this.onTurnStart?.(session)
		} catch (err) {
			console.warn("[ChatSessionManager] onTurnStart notification error:", err)
		}

		let targetProvider: ProviderName = "xkiro"
		try {
			// Resolve provider settings
			const preferences = await this.getPreferences()
			targetProvider = (session.modelPreference?.apiProvider || preferences.apiProvider || "xkiro") as ProviderName
			const targetModelId = session.modelPreference?.modelId || preferences.modelId || "openai/gpt-5.6-terra"
			const targetReasoningEffort = session.modelPreference?.reasoningEffort || preferences.reasoningEffort
			const effectiveWebSearchMode = params.webSearchMode || session.modelPreference?.webSearchMode || preferences.webSearchMode || "auto"

			const providerSettings = this.buildIsolatedProviderSettings(targetProvider, targetModelId, targetReasoningEffort)
			this.validateProviderCredentials(targetProvider, providerSettings)
			const apiHandler = buildApiHandler(providerSettings)

			// Web Search grounding
			let searchContext = ""
			if (effectiveWebSearchMode === "required" || (effectiveWebSearchMode === "auto" && this.shouldTriggerSearch(text))) {
				const globalSettings = this.getGlobalSettings ? this.getGlobalSettings() : {}
				const searchConfig = {
					enabled: globalSettings?.webSearchEnabled ?? true,
					provider: globalSettings?.webSearchProvider ?? "brave",
					apiKey: (this.getSecret ? this.getSecret("webSearchApiKey") : undefined) || globalSettings?.webSearchApiKey,
					searxngUrl: globalSettings?.webSearchSearxngUrl ?? "",
					maxResults: globalSettings?.webSearchMaxResults ?? 5,
				}

				const webSearchService = WebSearchService.getInstance()
				if (!webSearchService.isConfigured(searchConfig)) {
					let reason = "provider not configured"
					if (searchConfig.enabled === false) {
						reason = "web search is disabled in settings"
					} else if (searchConfig.provider === "searxng" && !searchConfig.searxngUrl) {
						reason = "SearXNG URL is missing"
					} else if (!searchConfig.apiKey) {
						reason = `${searchConfig.provider === "tavily" ? "Tavily" : "Brave"} Search API key is missing`
					}

					const configErrMsg = `Web search is not configured (${reason}). Please configure your search provider in Settings -> Web Access.`
					assistantMessage.error = configErrMsg
					assistantMessage.content = configErrMsg
					onChunk?.({ type: "error", error: configErrMsg })
					this.activeStreams.delete(sessionId)
					assistantMessage.isStreaming = false
					session.updatedAt = Date.now()
					await this.saveSession(session)
					onChunk?.({ type: "complete", messageId: assistantMessage.id })
					return assistantMessage
				}

				try {
					onChunk?.({ type: "status", status: "Searching the web..." })
					const searchQuery = this.extractSearchQuery(text, session.messages.slice(0, -2))
					const searchResults = await webSearchService.search(
						searchQuery,
						{
							maxResults: searchConfig.maxResults,
							signal: abortController.signal,
						},
						searchConfig,
					)

					if (abortController.signal.aborted) {
						return assistantMessage
					}

					assistantMessage.webSearch = {
						query: searchQuery,
						results: (searchResults || []).map((r) => ({
							title: r.title,
							url: r.url,
							snippet: r.snippet,
							domain: r.domain,
							publishedAt: r.publishedAt,
						})),
					}
					onChunk?.({ type: "webSearch", search: assistantMessage.webSearch })

					if (searchResults && searchResults.length > 0) {
						searchContext =
							`\n\n<web_search_context>\n` +
							`The application performed a live web search for: "${searchQuery}".\n` +
							`Verified search results (${searchResults.length}):\n\n` +
							searchResults
								.map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.snippet}`)
								.join("\n\n") +
							`\n\nInstructions for using search results:\n` +
							`- Ground your response in these verified live web sources.\n` +
							`- Reference and cite the actual URLs when presenting information.\n` +
							`- Do NOT state that you lack internet access, cannot browse the web, or don't know what the topic is, because the live search results above have been retrieved for you by the application.\n` +
							`</web_search_context>`
					} else {
						searchContext =
							`\n\n<web_search_context>\n` +
							`The application performed a live web search for: "${searchQuery}", but 0 results were found.\n` +
							`Inform the user honestly that web search returned no results for this query.\n` +
							`</web_search_context>`
					}
				} catch (searchErr: any) {
					if (abortController.signal.aborted) {
						return assistantMessage
					}
					const searchErrMsg = `Web search failed: ${searchErr?.message || String(searchErr)}`
					console.warn("[ChatSessionManager] Web search execution error:", searchErr)
					assistantMessage.error = searchErrMsg
					assistantMessage.content = searchErrMsg
					onChunk?.({ type: "error", error: searchErrMsg })
					this.activeStreams.delete(sessionId)
					assistantMessage.isStreaming = false
					session.updatedAt = Date.now()
					await this.saveSession(session)
					onChunk?.({ type: "complete", messageId: assistantMessage.id })
					return assistantMessage
				}
			}

			// Format messages for ApiHandler
			const systemPrompt =
				"You are a helpful, brilliant, concise, and accurate AI programming and general assistant in Roo Code GUI. " +
				"Answer the user's questions clearly, accurately, and thoughtfully. Use Markdown for formatting code, lists, and tables." +
				(searchContext ? `\n\n${searchContext}` : "")

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
				let errMsg = error?.message || String(error)
				const is401 = errMsg.includes("401") || errMsg.includes("Invalid or disabled ClientApiKey") || errMsg.toLowerCase().includes("unauthorized")
				if (is401) {
					errMsg = `Authentication failed (401): Invalid or disabled API key for ${targetProvider}. Please verify your API key in Settings.`
				}
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

	private validateProviderCredentials(provider: ProviderName, settings: ProviderSettings): void {
		let hasKey = false
		const providerDisplayName = provider === "xkiro" ? "xKiro" : provider

		switch (provider) {
			case "xkiro":
				hasKey = Boolean(
					(settings.xkiroApiKey && settings.xkiroApiKey.trim().length > 0 && settings.xkiroApiKey !== "not-provided") ||
					(settings.apiKey && settings.apiKey.trim().length > 0 && settings.apiKey !== "not-provided")
				)
				break
			case "openrouter":
				hasKey = Boolean(
					(settings.openRouterApiKey && settings.openRouterApiKey.trim().length > 0 && settings.openRouterApiKey !== "not-provided") ||
					(settings.apiKey && settings.apiKey.trim().length > 0 && settings.apiKey !== "not-provided")
				)
				break
			case "anthropic":
				hasKey = Boolean(settings.apiKey && settings.apiKey.trim().length > 0 && settings.apiKey !== "not-provided")
				break
			case "openai-native":
				hasKey = Boolean(
					(settings.openAiNativeApiKey && settings.openAiNativeApiKey.trim().length > 0 && settings.openAiNativeApiKey !== "not-provided") ||
					(settings.apiKey && settings.apiKey.trim().length > 0 && settings.apiKey !== "not-provided")
				)
				break
			case "deepseek":
				hasKey = Boolean(
					(settings.deepSeekApiKey && settings.deepSeekApiKey.trim().length > 0 && settings.deepSeekApiKey !== "not-provided") ||
					(settings.apiKey && settings.apiKey.trim().length > 0 && settings.apiKey !== "not-provided")
				)
				break
			case "gemini":
				hasKey = Boolean(
					(settings.geminiApiKey && settings.geminiApiKey.trim().length > 0 && settings.geminiApiKey !== "not-provided") ||
					(settings.apiKey && settings.apiKey.trim().length > 0 && settings.apiKey !== "not-provided")
				)
				break
			case "ollama":
			case "lmstudio":
			case "vscode-lm":
				hasKey = true
				break
			default:
				hasKey = Boolean(
					(settings.apiKey && settings.apiKey.trim().length > 0 && settings.apiKey !== "not-provided") ||
					(settings.openAiApiKey && settings.openAiApiKey.trim().length > 0 && settings.openAiApiKey !== "not-provided"),
				)
				break
		}

		if (!hasKey) {
			throw new Error(`Missing API key for ${providerDisplayName}. Please configure your API key in Settings.`)
		}
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

		// Helper to safely inspect profiles from roo_cline_config_api_config secret or getProviderProfiles
		let profileConfig: any = undefined
		try {
			if (this.getProviderProfiles) {
				const prof = this.getProviderProfiles()
				if (prof && prof.apiConfigs) {
					profileConfig = prof
				}
			}
		} catch {}

		if (!profileConfig) {
			try {
				const rawProfiles = this.getSecret?.("roo_cline_config_api_config")
				if (rawProfiles) {
					profileConfig = JSON.parse(rawProfiles)
				}
			} catch {}
		}

		let matchedProfile: any = undefined
		if (profileConfig?.apiConfigs) {
			const configs = profileConfig.apiConfigs
			const currentName = profileConfig.currentApiConfigName
			// Prefer current active profile if it matches target provider
			if (currentName && configs[currentName]?.apiProvider === provider) {
				matchedProfile = configs[currentName]
			}
			// If active profile does not match or lacks credentials, search for matching profile with valid key
			if (!matchedProfile || (!matchedProfile.xkiroApiKey && !matchedProfile.openRouterApiKey && !matchedProfile.apiKey && !matchedProfile.openAiNativeApiKey && !matchedProfile.deepSeekApiKey && !matchedProfile.geminiApiKey)) {
				for (const key of Object.keys(configs)) {
					const candidate = configs[key]
					if (candidate?.apiProvider === provider) {
						if (candidate.xkiroApiKey || candidate.openRouterApiKey || candidate.apiKey || candidate.openAiNativeApiKey || candidate.deepSeekApiKey || candidate.geminiApiKey) {
							matchedProfile = candidate
							break
						} else if (!matchedProfile) {
							matchedProfile = candidate
						}
					}
				}
			}
		}

		// Inject credentials for target provider without modifying global settings and avoiding cross-provider key leaks
		if (provider === "xkiro") {
			const isGlobalXkiro = globalSettings.apiProvider === "xkiro"
			settings.xkiroApiKey =
				this.getSecret?.("xkiroApiKey") ||
				matchedProfile?.xkiroApiKey ||
				matchedProfile?.apiKey ||
				globalSettings.xkiroApiKey ||
				(isGlobalXkiro ? (this.getSecret?.("apiKey") || globalSettings.apiKey) : undefined)
			settings.xkiroBaseUrl =
				matchedProfile?.xkiroBaseUrl ||
				globalSettings.xkiroBaseUrl ||
				"https://api.xkiro.com/v1"
			if (matchedProfile?.xkiroCustomModelInfo) {
				settings.xkiroCustomModelInfo = matchedProfile.xkiroCustomModelInfo
			}
			if (matchedProfile?.xkiroCustomContextWindow) {
				settings.xkiroCustomContextWindow = matchedProfile.xkiroCustomContextWindow
			}
		} else if (provider === "openrouter") {
			const isGlobalOpenRouter = globalSettings.apiProvider === "openrouter"
			settings.openRouterApiKey =
				this.getSecret?.("openRouterApiKey") ||
				matchedProfile?.openRouterApiKey ||
				matchedProfile?.apiKey ||
				globalSettings.openRouterApiKey ||
				(isGlobalOpenRouter ? (this.getSecret?.("apiKey") || globalSettings.apiKey) : undefined)
			if (matchedProfile?.openRouterBaseUrl) {
				settings.openRouterBaseUrl = matchedProfile.openRouterBaseUrl
			}
		} else if (provider === "anthropic") {
			const isGlobalAnthropic = globalSettings.apiProvider === "anthropic" || !globalSettings.apiProvider
			settings.apiKey =
				(isGlobalAnthropic ? this.getSecret?.("apiKey") : undefined) ||
				matchedProfile?.apiKey ||
				globalSettings.apiKey
			if (matchedProfile?.anthropicBaseUrl) {
				settings.anthropicBaseUrl = matchedProfile.anthropicBaseUrl
			}
		} else if (provider === "openai-native") {
			const isGlobalOai = globalSettings.apiProvider === "openai-native"
			settings.openAiNativeApiKey =
				this.getSecret?.("openAiNativeApiKey") ||
				matchedProfile?.openAiNativeApiKey ||
				matchedProfile?.apiKey ||
				globalSettings.openAiNativeApiKey ||
				(isGlobalOai ? (this.getSecret?.("apiKey") || globalSettings.apiKey) : undefined)
		} else if (provider === "deepseek") {
			const isGlobalDeepSeek = globalSettings.apiProvider === "deepseek"
			settings.deepSeekApiKey =
				this.getSecret?.("deepSeekApiKey") ||
				matchedProfile?.deepSeekApiKey ||
				matchedProfile?.apiKey ||
				globalSettings.deepSeekApiKey ||
				(isGlobalDeepSeek ? (this.getSecret?.("apiKey") || globalSettings.apiKey) : undefined)
		} else if (provider === "gemini") {
			const isGlobalGemini = globalSettings.apiProvider === "gemini"
			settings.geminiApiKey =
				this.getSecret?.("geminiApiKey") ||
				matchedProfile?.geminiApiKey ||
				matchedProfile?.apiKey ||
				globalSettings.geminiApiKey ||
				(isGlobalGemini ? (this.getSecret?.("apiKey") || globalSettings.apiKey) : undefined)
		} else {
			// Generic fallback
			const isGlobalCurrent = globalSettings.apiProvider === provider
			settings.apiKey =
				matchedProfile?.apiKey ||
				(isGlobalCurrent ? (this.getSecret?.("apiKey") || globalSettings.apiKey) : undefined)
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
		if (!text) return false
		const trimmed = text.trim()
		const lower = trimmed.toLowerCase()

		// Slash command prefix
		if (/^\/web(?:\s+|$)/i.test(trimmed)) {
			return true
		}

		// Polish explicit search directives & keywords
		if (
			/(?:je[zż]eli|je[sś]li)?\s*nie\s*wiesz.*?(?:przeszukaj|poszukaj|wyszukaj|sprawd[zź])/i.test(lower) ||
			/\b(?:przeszukaj|wyszukaj|poszukaj|znajd[zź]|sprawd[zź])\s+(?:w\s+)?(?:internecie|internet|sieci|sie[cć]|online|google|www|web)\b/i.test(lower) ||
			/\b(?:przeszukaj|poszukaj|wyszukaj)\s+(?:informacj[ie]|pod\s+k[aą]tem|na\s+temat|w\s+poszukiwaniu|stron[eęy]|dokumentacj[eęi])\b/i.test(lower) ||
			/\b(?:przeszukaj|wyszukaj)\s+(?:internet|sie[cć]|www)\b/i.test(lower) ||
			/\b(?:wyszukaj|przeszukaj)\b/i.test(lower) ||
			/\b(?:sprawd[zź]|poszukaj)\s+(?:to|tego)\s+(?:w\s+)?(?:internecie|internet|sieci|sie[cć]|online)\b/i.test(lower) ||
			/\b(?:zr[oó]b|zrob)\s+research\b/i.test(lower) ||
			/\boficjaln[aey]\s+stron[aęy]\b/i.test(lower) ||
			/\baktualn[aey]\s+informacj[eaęy]\b/i.test(lower) ||
			/\bnajnowsz[aey]\s+(?:wersj[eaę]|release|changelog|informacj[eaęy]|dokumentacj[eaęi])\b/i.test(lower) ||
			/\bco nowego\b/i.test(lower)
		) {
			return true
		}

		// English explicit search directives & keywords
		if (
			/\bif\s+you\s+don'?t\s+know.*?(?:search|look\s*up|check|browse)\b/i.test(lower) ||
			/\b(?:search|look\s*up|browse|find)\s+(?:the\s+)?(?:web|internet|online)\b/i.test(lower) ||
			/\b(?:search|look\s*up)\s+(?:this|it|that)\s+(?:online|on\s+the\s+web|in\s+the\s+internet)\b/i.test(lower) ||
			/\b(?:search\s+for|look\s*up|find)\s+(?:the\s+)?(?:latest|recent|official)\b/i.test(lower) ||
			/\b(?:latest\s+news|release\s+notes|changelog|latest\s+documentation|official\s+website)\b/i.test(lower) ||
			/\bgoogle\s+(?:it|this|that)\b/i.test(lower) ||
			/\bsearch\s+online\b/i.test(lower) ||
			/\b(?:search|look\s*up)\s+for\b/i.test(lower)
		) {
			return true
		}

		return false
	}

	private extractSearchQuery(text: string, previousMessages?: ChatMessage[]): string {
		let cleaned = text.replace(/^\/web\s+/i, "").trim()

		// Match patterns where query is explicitly after keywords
		const explicitMatch = cleaned.match(
			/^(?:prosz[eę]\s+)?(?:wyszukaj|przeszukaj|poszukaj|znajd[zź]|sprawd[zź]|search(?:\s+the\s+web|\s+online)?\s+for|search|look\s+up)\s+(?:w\s+internecie\s+|w\s+sieci\s+|online\s+)?(?:czym\s+jest\s+|co\s+to\s+jest\s+|informacj[ie]\s+(?:o|na\s+temat)\s+)?(.+)/i,
		)
		if (explicitMatch && explicitMatch[1]) {
			cleaned = explicitMatch[1].trim()
		} else {
			// Strip common leading trigger commands
			cleaned = cleaned
				.replace(
					/^(?:(?:je[zż]eli|je[sś]li)?\s*nie\s*wiesz\s*(?:o\s+co\s+chodzi)?[,\s]*(?:to\s+)?)?(?:przeszukaj|poszukaj|wyszukaj|sprawd[zź])\s+(?:w\s+)?(?:internecie|internet|sieci|sie[cć]|online|google|www|web)?(?:\s+(?:informacj[ie]|pod\s+k[aą]tem|na\s+temat|w\s+poszukiwaniu|o))?\s*/i,
					"",
				)
				.replace(/^(?:search|look\s*up|browse|find)\s+(?:the\s+)?(?:web|internet|online)?(?:\s+(?:for|about))?\s*/i, "")
				.trim()
		}

		// Strip trailing filler
		cleaned = cleaned
			.replace(/\s+(?:w\s+internecie|w\s+sieci|online|in\s+the\s+web|on\s+the\s+web|internet|sie[cć])$/i, "")
			.replace(/[?!.]+$/, "")
			.trim()

		// If the cleaned text is empty or purely reference pronoun/phrase ("to", "tego", "it", "this", "o co chodzi", "internet", etc.)
		const isReferential =
			!cleaned ||
			/^(?:to|tego|tamto|it|this|that|them|o\s+co\s+chodzi|o\s+czym\s+mowa|internet|internecie|w\s+internecie|sie[cć]|sieci|w\s+sieci|online)$/i.test(cleaned)

		if (isReferential && previousMessages && previousMessages.length > 0) {
			// Look backwards for the most recent user prompt
			for (let i = previousMessages.length - 1; i >= 0; i--) {
				const prev = previousMessages[i]
				if (prev.role === "user" && prev.content && prev.content.trim()) {
					let prevCleaned = prev.content
						.replace(
							/^(?:czym\s+(?:w[łl]a[sś]ciwie\s+)?jest(?:\s+us[łl]uga|\s+to|\s+narz[ęe]dzie)?|co\s+to\s+jest|opowiedz\s+mi\s+o|jak\s+dzia[łl]a|what\s+is(?:\s+the)?|tell\s+me\s+about)\s+/i,
							"",
						)
						.replace(/[?!.]+$/, "")
						.trim()
					if (prevCleaned) {
						return prevCleaned.slice(0, 100)
					}
				}
			}
		}

		return (cleaned || text.trim()).slice(0, 100)
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
