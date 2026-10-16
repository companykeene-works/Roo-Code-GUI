import { z } from "zod"

export const chatWebSearchModeSchema = z.enum(["off", "auto", "required"])
export type ChatWebSearchMode = z.infer<typeof chatWebSearchModeSchema>

export const chatSearchResultItemSchema = z.object({
	title: z.string(),
	url: z.string(),
	snippet: z.string(),
})
export type ChatSearchResultItem = z.infer<typeof chatSearchResultItemSchema>

export const chatWebSearchDataSchema = z.object({
	query: z.string(),
	results: z.array(chatSearchResultItemSchema),
})
export type ChatWebSearchData = z.infer<typeof chatWebSearchDataSchema>

export const chatMessageTokenUsageSchema = z.object({
	promptTokens: z.number().optional(),
	completionTokens: z.number().optional(),
	totalTokens: z.number().optional(),
})
export type ChatMessageTokenUsage = z.infer<typeof chatMessageTokenUsageSchema>

export const chatMessageSchema = z.object({
	id: z.string(),
	role: z.enum(["user", "assistant"]),
	content: z.string(),
	reasoning: z.string().optional(),
	images: z.array(z.string()).optional(),
	webSearch: chatWebSearchDataSchema.optional(),
	tokenUsage: chatMessageTokenUsageSchema.optional(),
	timestamp: z.number(),
	isStreaming: z.boolean().optional(),
	error: z.string().optional(),
})
export type ChatMessage = z.infer<typeof chatMessageSchema>

export const chatModelPreferenceSchema = z.object({
	apiProvider: z.string().optional(),
	modelId: z.string().optional(),
	reasoningEffort: z.string().optional(),
	webSearchMode: chatWebSearchModeSchema.optional(),
})
export type ChatModelPreference = z.infer<typeof chatModelPreferenceSchema>

export const chatDraftSchema = z.object({
	text: z.string(),
	images: z.array(z.string()).optional(),
	webSearchMode: chatWebSearchModeSchema.optional(),
})
export type ChatDraft = z.infer<typeof chatDraftSchema>

export const chatSessionSchema = z.object({
	id: z.string(),
	title: z.string(),
	titleSource: z.enum(["initial", "auto", "manual"]).optional(),
	createdAt: z.number(),
	updatedAt: z.number(),
	modelPreference: chatModelPreferenceSchema.optional(),
	messages: z.array(chatMessageSchema),
	draft: chatDraftSchema.optional(),
})
export type ChatSession = z.infer<typeof chatSessionSchema>

export const chatSessionSummarySchema = z.object({
	id: z.string(),
	title: z.string(),
	createdAt: z.number(),
	updatedAt: z.number(),
	messageCount: z.number(),
	lastMessagePreview: z.string().optional(),
	modelPreference: chatModelPreferenceSchema.optional(),
})
export type ChatSessionSummary = z.infer<typeof chatSessionSummarySchema>

export const chatPreferencesSchema = z.object({
	apiProvider: z.string().optional(),
	modelId: z.string().optional(),
	reasoningEffort: z.string().optional(),
	webSearchMode: chatWebSearchModeSchema.optional(),
	enabled: z.boolean().optional(),
})
export type ChatPreferences = z.infer<typeof chatPreferencesSchema>

export type ChatStreamChunk =
	| { type: "text"; text: string }
	| { type: "reasoning"; text: string }
	| { type: "webSearch"; search: ChatWebSearchData }
	| { type: "usage"; usage: ChatMessageTokenUsage }
	| { type: "error"; error: string }
	| { type: "complete"; messageId: string }
