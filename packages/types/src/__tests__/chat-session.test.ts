import { describe, it, expect } from "vitest"
import {
	chatMessageSchema,
	chatSessionSchema,
	chatSessionSummarySchema,
	chatPreferencesSchema,
	type ChatSession,
	type ChatMessage,
} from "../chat-session.js"

describe("chat-session types & schemas", () => {
	it("validates a valid ChatMessage", () => {
		const msg: ChatMessage = {
			id: "msg-1",
			role: "user",
			content: "Cześć! Opowiedz o architekturze Roo Code.",
			timestamp: Date.now(),
		}
		expect(chatMessageSchema.parse(msg)).toEqual(msg)
	})

	it("validates assistant message with reasoning, webSearch and tokenUsage", () => {
		const msg: ChatMessage = {
			id: "msg-2",
			role: "assistant",
			content: "Oto podsumowanie...",
			reasoning: "Analizuję zapytanie użytkownika...",
			webSearch: {
				query: "Roo Code documentation",
				results: [
					{
						title: "Roo Code Docs",
						url: "https://roocode.com",
						snippet: "Autonomous AI coding assistant",
					},
				],
			},
			tokenUsage: {
				promptTokens: 150,
				completionTokens: 300,
				totalTokens: 450,
			},
			timestamp: Date.now(),
		}
		expect(chatMessageSchema.parse(msg)).toEqual(msg)
	})

	it("validates a full ChatSession", () => {
		const session: ChatSession = {
			id: "session-1",
			title: "Analiza projektu Velune",
			titleSource: "manual",
			createdAt: 1700000000000,
			updatedAt: 1700000050000,
			modelPreference: {
				apiProvider: "xkiro",
				modelId: "openai/gpt-5.6-terra",
				reasoningEffort: "medium",
				webSearchMode: "auto",
			},
			messages: [
				{
					id: "m-1",
					role: "user",
					content: "Hello",
					timestamp: 1700000000000,
				},
				{
					id: "m-2",
					role: "assistant",
					content: "Hello! How can I help you today?",
					timestamp: 1700000010000,
				},
			],
			draft: {
				text: "Draft message...",
				webSearchMode: "auto",
			},
		}
		expect(chatSessionSchema.parse(session)).toEqual(session)
	})

	it("validates ChatSessionSummary", () => {
		const summary = {
			id: "session-1",
			title: "Analiza projektu Velune",
			createdAt: 1700000000000,
			updatedAt: 1700000050000,
			messageCount: 2,
			lastMessagePreview: "Hello! How can I help you today?",
		}
		expect(chatSessionSummarySchema.parse(summary)).toEqual(summary)
	})

	it("validates ChatPreferences", () => {
		const pref = {
			apiProvider: "xkiro",
			modelId: "openai/gpt-5.6-terra",
			reasoningEffort: "medium",
			webSearchMode: "auto" as const,
			enabled: true,
		}
		expect(chatPreferencesSchema.parse(pref)).toEqual(pref)
	})
})
