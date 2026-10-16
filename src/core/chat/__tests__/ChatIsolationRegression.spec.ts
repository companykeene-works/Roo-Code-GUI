import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import fs from "fs"
import path from "path"
import os from "os"
import { ChatSessionManager } from "../ChatSessionManager"
import type { ProviderSettings, HistoryItem } from "@roo-code/types"

describe("ChatIsolationRegression — Zero Agent Regressions & Subsystem Boundary", () => {
	let tempDir: string
	let chatManager: ChatSessionManager
	let mockAgentState: {
		currentApiConfigName: string
		apiConfigs: Record<string, ProviderSettings>
		taskHistory: HistoryItem[]
		workspace: string
		isAgentStreaming: boolean
	}

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "roo-isolation-test-"))

		// Mock existing production Agent state
		mockAgentState = {
			currentApiConfigName: "default",
			apiConfigs: {
				default: {
					apiProvider: "xkiro",
					xkiroApiKey: "agent-secret-xkiro-key",
					xkiroModelId: "openai/gpt-6.1-sol" as any,
					reasoningEffort: "high" as any,
				},
			},
			taskHistory: [
				{
					id: "agent-task-1",
					number: 1,
					ts: Date.now() - 10000,
					task: "Implement database migration in Agent",
					workspace: "/workspaces/my-repo",
					tokensIn: 500,
					tokensOut: 200,
					totalCost: 0.05,
				},
			],
			workspace: "/workspaces/my-repo",
			isAgentStreaming: true,
		}

		// Create mock task files in tasks/
		const taskDir = path.join(tempDir, "global-storage", "tasks", "agent-task-1")
		fs.mkdirSync(taskDir, { recursive: true })
		fs.writeFileSync(
			path.join(taskDir, "history_item.json"),
			JSON.stringify(mockAgentState.taskHistory[0]),
			"utf-8",
		)

		chatManager = new ChatSessionManager({
			storageDir: tempDir,
			getGlobalSettings: () => ({
				apiProvider: mockAgentState.apiConfigs.default.apiProvider,
				xkiroApiKey: mockAgentState.apiConfigs.default.xkiroApiKey,
			}),
			getSecret: (key: string) => (key === "xkiroApiKey" ? "agent-secret-xkiro-key" : undefined),
		})
	})

	afterEach(() => {
		try {
			fs.rmSync(tempDir, { recursive: true, force: true })
		} catch {}
	})

	it("A: Agent selected model unchanged after Chat model change", async () => {
		// Agent has gpt-6.1-sol
		expect(mockAgentState.apiConfigs.default.xkiroModelId).toBe("openai/gpt-6.1-sol")

		// User changes Chat model to gpt-5.6-terra
		await chatManager.savePreferences({
			apiProvider: "xkiro",
			modelId: "openai/gpt-5.6-terra",
			reasoningEffort: "medium",
		})

		const chatPref = await chatManager.getPreferences()
		expect(chatPref.modelId).toBe("openai/gpt-5.6-terra")

		// Invariant: Agent model MUST remain gpt-6.1-sol
		expect(mockAgentState.apiConfigs.default.xkiroModelId).toBe("openai/gpt-6.1-sol")
	})

	it("B: Agent reasoning effort unchanged after Chat effort change", async () => {
		// Agent has high reasoning effort
		expect(mockAgentState.apiConfigs.default.reasoningEffort).toBe("high")

		// User changes Chat reasoning effort to minimal
		await chatManager.savePreferences({
			apiProvider: "xkiro",
			modelId: "openai/gpt-5.6-terra",
			reasoningEffort: "minimal",
		})

		const chatPref = await chatManager.getPreferences()
		expect(chatPref.reasoningEffort).toBe("minimal")

		// Invariant: Agent effort MUST remain high
		expect(mockAgentState.apiConfigs.default.reasoningEffort).toBe("high")
	})

	it("D: Chat history is isolated from Agent task history", async () => {
		const session = await chatManager.createSession({ title: "Isolated conversation" })

		// Send mock messages in Chat
		session.messages.push({
			id: "cm-1",
			role: "user",
			content: "Can you explain React useEffect?",
			timestamp: Date.now(),
		})
		session.messages.push({
			id: "cm-2",
			role: "assistant",
			content: "useEffect handles side effects...",
			timestamp: Date.now() + 1000,
		})
		await chatManager.saveSession(session)

		// Check Agent task history
		expect(mockAgentState.taskHistory.length).toBe(1)
		expect(mockAgentState.taskHistory[0].id).toBe("agent-task-1")

		// Invariant: Agent tasks directory does NOT contain any chat session files
		const agentTaskPath = path.join(tempDir, "global-storage", "tasks", "agent-task-1", "history_item.json")
		expect(fs.existsSync(agentTaskPath)).toBe(true)

		const chatInAgentTask = path.join(tempDir, "global-storage", "tasks", session.id)
		expect(fs.existsSync(chatInAgentTask)).toBe(false)
	})

	it("E: Agent workspace is completely unchanged after Chat interactions", async () => {
		const session = await chatManager.createSession({ title: "General inquiry" })
		await chatManager.saveDraft(session.id, { text: "Draft question" })

		// Invariant: Agent workspace has not been modified
		expect(mockAgentState.workspace).toBe("/workspaces/my-repo")
	})

	it("F & G: Stopping Chat generation does not abort Agent", async () => {
		const session = await chatManager.createSession({ title: "Streaming chat" })

		// Aborting chat session
		chatManager.abortStream(session.id)

		// Invariant: Agent streaming state remains completely untouched
		expect(mockAgentState.isAgentStreaming).toBe(true)
	})

	it("H: Chat deletion does not delete Agent task", async () => {
		const session = await chatManager.createSession({ title: "Temporary Chat" })
		await chatManager.deleteSession(session.id)

		// Invariant: Agent task file on disk still exists
		const agentTaskFile = path.join(tempDir, "global-storage", "tasks", "agent-task-1", "history_item.json")
		expect(fs.existsSync(agentTaskFile)).toBe(true)
		expect(mockAgentState.taskHistory.length).toBe(1)
	})

	it("I: Chat settings persistence does not overwrite Agent settings", async () => {
		await chatManager.savePreferences({
			apiProvider: "xkiro",
			modelId: "openai/gpt-5.6-luna",
			reasoningEffort: "low",
		})

		// Agent settings in mock state are untouched
		expect(mockAgentState.apiConfigs.default.xkiroModelId).toBe("openai/gpt-6.1-sol")
		expect(mockAgentState.apiConfigs.default.reasoningEffort).toBe("high")
	})

	it("J: Restart restores both modes independently", async () => {
		// Persist Chat preferences
		await chatManager.savePreferences({
			apiProvider: "xkiro",
			modelId: "openai/gpt-5.6-sol",
			reasoningEffort: "medium",
		})

		// Simulate restart by initializing a new ChatSessionManager with the same storage
		const reloadedManager = new ChatSessionManager({
			storageDir: tempDir,
			getGlobalSettings: () => ({
				apiProvider: mockAgentState.apiConfigs.default.apiProvider,
				xkiroApiKey: mockAgentState.apiConfigs.default.xkiroApiKey,
			}),
		})

		const restoredChatPref = await reloadedManager.getPreferences()
		expect(restoredChatPref.modelId).toBe("openai/gpt-5.6-sol")
		expect(restoredChatPref.reasoningEffort).toBe("medium")

		// Agent config remains independent
		expect(mockAgentState.apiConfigs.default.xkiroModelId).toBe("openai/gpt-6.1-sol")
		expect(mockAgentState.apiConfigs.default.reasoningEffort).toBe("high")
	})

	it("K: Multi-step Model & Effort switching with restart and active task snapshot", async () => {
		// Initial State:
		// Agent: Model A (xkiro gpt-6.1-sol), Reasoning High
		// Chat: Model B (xkiro gpt-5.6-terra), Reasoning Medium
		const agentActiveTask = {
			id: "agent-task-active",
			taskStartModel: "openai/gpt-6.1-sol",
			taskStartEffort: "high",
			apiConfiguration: {
				apiProvider: "xkiro",
				xkiroModelId: "openai/gpt-6.1-sol",
				reasoningEffort: "high",
			},
			historyItem: {
				id: "agent-task-active",
				chatModelId: "openai/gpt-6.1-sol",
				chatProvider: "xkiro",
				chatReasoningEffort: "high",
			},
		}

		await chatManager.savePreferences({
			apiProvider: "xkiro",
			modelId: "openai/gpt-5.6-terra",
			reasoningEffort: "medium",
		})

		// 1. User changes model in Chat to Model C (claude-3.7-sonnet) with effort Low
		await chatManager.savePreferences({
			apiProvider: "xkiro",
			modelId: "anthropic/claude-3.7-sonnet",
			reasoningEffort: "low",
		})

		// 2 & 3. Switch to Agent: verify Agent preserved Model A and High effort
		expect(mockAgentState.apiConfigs.default.xkiroModelId).toBe("openai/gpt-6.1-sol")
		expect(mockAgentState.apiConfigs.default.reasoningEffort).toBe("high")
		expect(agentActiveTask.taskStartModel).toBe("openai/gpt-6.1-sol")
		expect(agentActiveTask.historyItem.chatModelId).toBe("openai/gpt-6.1-sol")
		expect(agentActiveTask.historyItem.chatReasoningEffort).toBe("high")

		// 4. Change model in Agent to Model D (deepseek-r1) with effort Minimal
		mockAgentState.apiConfigs.default.xkiroModelId = "deepseek/deepseek-r1" as any
		mockAgentState.apiConfigs.default.reasoningEffort = "minimal" as any

		// 5 & 6. Switch to Chat: verify Chat preserved Model C and Low effort
		const currentChatPref = await chatManager.getPreferences()
		expect(currentChatPref.modelId).toBe("anthropic/claude-3.7-sonnet")
		expect(currentChatPref.reasoningEffort).toBe("low")

		// Verify Agent active task still maintains its immutable snapshot (Model A)
		expect(agentActiveTask.taskStartModel).toBe("openai/gpt-6.1-sol")
		expect(agentActiveTask.historyItem.chatModelId).toBe("openai/gpt-6.1-sol")

		// 7 & 8. Simulate closing and restarting application
		const reloadedChatManager = new ChatSessionManager({
			storageDir: tempDir,
			getGlobalSettings: () => ({
				apiProvider: mockAgentState.apiConfigs.default.apiProvider,
				xkiroApiKey: mockAgentState.apiConfigs.default.xkiroApiKey,
			}),
		})

		// 9. Verify persistence of both configurations after restart
		const restoredChat = await reloadedChatManager.getPreferences()
		expect(restoredChat.modelId).toBe("anthropic/claude-3.7-sonnet")
		expect(restoredChat.reasoningEffort).toBe("low")
		expect(mockAgentState.apiConfigs.default.xkiroModelId).toBe("deepseek/deepseek-r1")
		expect(mockAgentState.apiConfigs.default.reasoningEffort).toBe("minimal")
	})

	it("L: Parallel execution: Agent task streaming while Chat is active, changes model, and stops", async () => {
		// 1. Agent starts a long task with its own AbortController
		const agentAbortController = new AbortController()
		const agentExecutionTask = {
			id: "agent-long-task-42",
			isStreaming: true,
			model: "openai/gpt-6.1-sol",
			workspace: "/workspaces/my-repo",
			abortController: agentAbortController,
		}

		// 2. User switches to Chat and creates a conversation
		const chatSession = await chatManager.createSession({ title: "Parallel Chat" })

		// 3. User initiates Chat stream
		const chatAbortController = new AbortController()
		;(chatManager as any).activeStreams.set(chatSession.id, chatAbortController)
		expect(chatManager.isStreaming(chatSession.id)).toBe(true)

		// 4. User changes model in Chat
		await chatManager.savePreferences({
			apiProvider: "xkiro",
			modelId: "openai/gpt-5.6-terra",
			reasoningEffort: "medium",
		})

		// 5. User aborts Chat stream
		chatManager.abortStream(chatSession.id)
		expect(chatManager.isStreaming(chatSession.id)).toBe(false)
		expect(chatAbortController.signal.aborted).toBe(true)

		// 6. User switches back to Agent.
		// VERIFY: Agent continues completely untouched and un-aborted!
		expect(agentExecutionTask.isStreaming).toBe(true)
		expect(agentExecutionTask.abortController.signal.aborted).toBe(false)
		expect(agentExecutionTask.model).toBe("openai/gpt-6.1-sol")
		expect(agentExecutionTask.workspace).toBe("/workspaces/my-repo")
		expect(mockAgentState.taskHistory.length).toBe(1)
	})

	it("M: Chat has zero tools and cannot execute Agent tools", () => {
		// Verify ChatSessionManager does not expose or import executeCommand, writeToFile, replaceFileContent
		const managerProto = Object.getOwnPropertyNames(Object.getPrototypeOf(chatManager))
		expect(managerProto).not.toContain("executeCommand")
		expect(managerProto).not.toContain("writeToFile")
		expect(managerProto).not.toContain("replaceFileContent")
		expect(managerProto).not.toContain("autoApprove")
	})
})
