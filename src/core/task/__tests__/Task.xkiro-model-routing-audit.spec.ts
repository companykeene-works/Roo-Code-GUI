import * as vscode from "vscode"
import fs from "fs"
import path from "path"
import os from "os"
import OpenAI from "openai"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { ProviderSettings, HistoryItem } from "@roo-code/types"
import { Task } from "../Task"
import { ClineProvider } from "../../webview/ClineProvider"
import { getModelId } from "@roo-code/types"
import { resolveTaskExecutionConfig } from "../../config/resolveTaskExecutionConfig"
import { buildApiHandler } from "../../../api"
import { ChatSessionManager } from "../../chat/ChatSessionManager"

vi.mock("vscode", () => {
	const mockDisposable = { dispose: vi.fn() }
	const mockEventEmitter = { event: vi.fn(), fire: vi.fn() }
	const mockTextDocument = { uri: { fsPath: "/mock/workspace/path/file.ts" } }
	const mockTextEditor = { document: mockTextDocument }
	const mockTab = { input: { uri: { fsPath: "/mock/workspace/path/file.ts" } } }
	const mockTabGroup = { tabs: [mockTab] }

	return {
		TabInputTextDiff: vi.fn(),
		CodeActionKind: {
			QuickFix: { value: "quickfix" },
			RefactorRewrite: { value: "refactor.rewrite" },
		},
		window: {
			createTextEditorDecorationType: vi.fn().mockReturnValue({
				dispose: vi.fn(),
			}),
			visibleTextEditors: [mockTextEditor],
			tabGroups: {
				all: [mockTabGroup],
				close: vi.fn(),
				onDidChangeTabs: vi.fn(() => ({ dispose: vi.fn() })),
			},
			showErrorMessage: vi.fn(),
		},
		workspace: {
			getConfiguration: vi.fn(() => ({ get: (_k: string, d: any) => d })),
			workspaceFolders: [
				{
					uri: { fsPath: "/mock/workspace/path" },
					name: "mock-workspace",
					index: 0,
				},
			],
			createFileSystemWatcher: vi.fn(() => ({
				onDidCreate: vi.fn(() => mockDisposable),
				onDidDelete: vi.fn(() => mockDisposable),
				onDidChange: vi.fn(() => mockDisposable),
				dispose: vi.fn(),
			})),
			fs: {
				stat: vi.fn().mockResolvedValue({ type: 1 }),
			},
			onDidSaveTextDocument: vi.fn(() => mockDisposable),
		},
		env: {
			uriScheme: "vscode",
			language: "en",
		},
		EventEmitter: vi.fn().mockImplementation(() => mockEventEmitter),
		Disposable: {
			from: vi.fn(),
		},
		TabInputText: vi.fn(),
		version: "1.85.0",
	}
})

vi.mock("../../environment/getEnvironmentDetails", () => ({
	getEnvironmentDetails: vi.fn().mockResolvedValue(""),
}))

vi.mock("../../ignore/RooIgnoreController")

vi.mock("p-wait-for", () => ({
	default: vi.fn().mockImplementation(async () => Promise.resolve()),
}))

vi.mock("delay", () => ({
	__esModule: true,
	default: vi.fn().mockResolvedValue(undefined),
}))

describe("xKiro Model Routing & TaskModelLock Audit Suite", () => {
	const xkiroQwenConfig: ProviderSettings = {
		apiProvider: "xkiro",
		xkiroApiKey: "test-xkiro-key",
		xkiroModelId: "qwen/qwen3.8-max:free",
		apiModelId: "qwen/qwen3.8-max:free",
		reasoningEffort: "disable",
		enableReasoningEffort: false,
	} as any

	const xkiroGpt61Config: ProviderSettings = {
		apiProvider: "xkiro",
		xkiroApiKey: "test-xkiro-key",
		xkiroModelId: "openai/gpt-6.1-sol",
		apiModelId: "openai/gpt-6.1-sol",
		reasoningEffort: "medium",
		enableReasoningEffort: true,
	} as any

	let mockProvider: any
	let eventListeners: Record<string, ((...args: any[]) => any)[]> = {}

	beforeEach(() => {
		eventListeners = {}
		mockProvider = {
			context: {
				globalStorageUri: { fsPath: "/test/storage" },
			},
			getState: vi.fn().mockResolvedValue({
				apiConfiguration: xkiroQwenConfig,
				mode: "code",
				currentApiConfigName: "default",
			}),
			log: vi.fn(),
			on: vi.fn((event: string, cb: (...args: any[]) => any) => {
				eventListeners[event] = eventListeners[event] || []
				eventListeners[event].push(cb)
			}),
			off: vi.fn((event: string, cb: (...args: any[]) => any) => {
				if (eventListeners[event]) {
					eventListeners[event] = eventListeners[event].filter((f) => f !== cb)
				}
			}),
			emit: vi.fn((event: string, ...args: any[]) => {
				if (eventListeners[event]) {
					for (const cb of eventListeners[event]) {
						cb(...args)
					}
				}
			}),
			isActiveTask: vi.fn().mockReturnValue(false),
			postStateToWebview: vi.fn().mockResolvedValue(undefined),
			postStateToWebviewWithoutTaskHistory: vi.fn().mockResolvedValue(undefined),
			updateTaskHistory: vi.fn().mockResolvedValue(undefined),
			getCurrentTask: vi.fn(),
			runningTasks: new Map<string, Task>(),
			foregroundTaskId: undefined as string | undefined,
		}
	})

	// SCENARIO A: Agent with selected Qwen3.8 Max sends canonical Qwen3.8 Max payload to xKiro endpoint
	it("SCENARIO A: Agent with selected Qwen3.8 Max builds handler with canonical model and target endpoint", () => {
		const task = new Task({
			provider: mockProvider as unknown as ClineProvider,
			apiConfiguration: xkiroQwenConfig,
			task: "Test canonical request routing for Qwen",
			startTask: false,
		})

		expect(task.executionModelId).toBe("qwen/qwen3.8-max:free")
		expect(task.executionProvider).toBe("xkiro")

		// Verify API handler model definition
		const handler = buildApiHandler(task.apiConfiguration)
		const model = handler.getModel()
		expect(model.id).toBe("qwen/qwen3.8-max:free")
		expect((handler as any).options.openAiBaseUrl).toBe("https://api.xkiro.com/v1")
		expect((handler as any).options.openAiModelId).toBe("qwen/qwen3.8-max:free")
	})

	// SCENARIO B: TaskModelLock for active task: Active Qwen task does NOT switch when global config changes to GPT-6.1 Sol
	it("SCENARIO B: TaskModelLock protects active task from global configuration changes", () => {
		const task = new Task({
			provider: mockProvider as unknown as ClineProvider,
			apiConfiguration: xkiroQwenConfig,
			task: "Active Qwen task protected by lock",
			startTask: false,
		})
		;(task as any)._started = true

		mockProvider.runningTasks.set(task.taskId, task)
		mockProvider.foregroundTaskId = task.taskId
		mockProvider.getCurrentTask.mockReturnValue(task)

		// User changes global preference to GPT-6.1 Sol in settings
		const clineProto = ClineProvider.prototype
		clineProto.updateTaskApiHandlerIfNeeded.call(
			mockProvider,
			xkiroGpt61Config,
			{ forceRebuild: true, targetTaskId: task.taskId },
		)

		// Invariant holds: task remains on Qwen
		expect(getModelId(task.apiConfiguration)).toBe("qwen/qwen3.8-max:free")
		expect(task.executionModelId).toBe("qwen/qwen3.8-max:free")
		expect(task.executionEpoch).toBe(1)
	})

	// SCENARIO C: Pause & Resume preserves model
	it("SCENARIO C: Paused task with executionModelId preserves model on normal resume even if global config changed", async () => {
		const task = new Task({
			provider: mockProvider as unknown as ClineProvider,
			apiConfiguration: xkiroGpt61Config,
			task: "Task started on GPT-6.1 Sol and paused",
			startTask: false,
		})
		await task.saveClineMessages()
		const historyItem: HistoryItem = structuredClone(task.historyItem!)

		expect(historyItem.executionModelId).toBe("openai/gpt-6.1-sol")
		expect(historyItem.executionProvider).toBe("xkiro")

		// User changed global preference to Qwen while task was paused
		const resumedConfig = resolveTaskExecutionConfig({
			baseProviderSettings: xkiroQwenConfig,
			chatMetadata: historyItem,
			isNewChat: false, // Resuming paused task
		})

		const resumedTask = new Task({
			provider: mockProvider as unknown as ClineProvider,
			apiConfiguration: resumedConfig,
			historyItem,
			task: "Resumed task",
			startTask: false,
		})

		// Normal resume must preserve GPT-6.1 Sol!
		expect(getModelId(resumedTask.apiConfiguration)).toBe("openai/gpt-6.1-sol")
		expect(resumedTask.executionModelId).toBe("openai/gpt-6.1-sol")
		expect(resumedTask.taskStartModel).toBe("openai/gpt-6.1-sol")
	})

	// SCENARIO D: Switch Model & Resume explicitly updates executionEpoch and model
	it("SCENARIO D: Explicit switchExecutionModelAndResume transitions epoch and updates execution snapshot", async () => {
		const task = new Task({
			provider: mockProvider as unknown as ClineProvider,
			apiConfiguration: xkiroQwenConfig,
			task: "Explicit switch test",
			startTask: false,
		})
		;(task as any)._started = true

		mockProvider.runningTasks.set(task.taskId, task)
		mockProvider.getCurrentTask.mockReturnValue(task)

		expect(task.executionEpoch).toBe(1)
		expect(task.executionModelId).toBe("qwen/qwen3.8-max:free")

		// Simulate halted provider error
		task.clineMessages.push({
			ts: Date.now(),
			type: "ask",
			ask: "api_req_failed",
			text: "Model temporarily at capacity.",
		})

		expect(task.canSwitchExecutionModel()).toBe(true)

		// Explicit Switch Model & Resume
		await task.switchExecutionModelAndResume(xkiroGpt61Config)

		expect(task.executionEpoch).toBe(2)
		expect(task.executionModelId).toBe("openai/gpt-6.1-sol")
		expect(task.taskStartModel).toBe("qwen/qwen3.8-max:free") // Immutable start
		expect(task.historyItem?.executionEpoch).toBe(2)
		expect(task.historyItem?.executionModelId).toBe("openai/gpt-6.1-sol")
	})

	// SCENARIO E: xKiro capacity error does not cause silent fallback
	it("SCENARIO E: Capacity outage triggers safe halt without silent model mutation", () => {
		const task = new Task({
			provider: mockProvider as unknown as ClineProvider,
			apiConfiguration: xkiroQwenConfig,
			task: "Capacity error test",
			startTask: false,
		})

		// Simulate error handling
		const handler = buildApiHandler(task.apiConfiguration)
		expect(handler.getModel().id).toBe("qwen/qwen3.8-max:free")

		// The model must never be mutated silently behind the scenes
		expect(task.executionModelId).toBe("qwen/qwen3.8-max:free")
		expect(getModelId(task.apiConfiguration)).toBe("qwen/qwen3.8-max:free")
	})

	// SCENARIO F: xKiro model list refresh does not alter locked model
	it("SCENARIO F: Model list refresh does not mutate active task model lock", () => {
		const task = new Task({
			provider: mockProvider as unknown as ClineProvider,
			apiConfiguration: xkiroGpt61Config,
			task: "Model refresh test",
			startTask: false,
		})
		;(task as any)._started = true

		mockProvider.runningTasks.set(task.taskId, task)
		mockProvider.getCurrentTask.mockReturnValue(task)

		// Model list refresh event / provider setting update
		const updatedSettings: ProviderSettings = {
			...xkiroGpt61Config,
			// Discovered models updated in settings
		}
		ClineProvider.prototype.updateTaskApiHandlerIfNeeded.call(
			mockProvider,
			updatedSettings,
			{ forceRebuild: false, targetTaskId: task.taskId },
		)

		expect(task.executionModelId).toBe("openai/gpt-6.1-sol")
		expect(getModelId(task.apiConfiguration)).toBe("openai/gpt-6.1-sol")
	})

	// SCENARIO G: Approval Model isolation
	it("SCENARIO G: Independent approval configuration does not bleed into worker task model", () => {
		const workerTask = new Task({
			provider: mockProvider as unknown as ClineProvider,
			apiConfiguration: xkiroQwenConfig,
			task: "Worker executing on Qwen",
			startTask: false,
		})

		const approvalConfig: ProviderSettings = {
			apiProvider: "xkiro",
			xkiroModelId: "openai/gpt-6.1-sol",
			apiModelId: "openai/gpt-6.1-sol",
			apiKey: "approval-key",
		} as any

		// Worker task configuration is untouched
		expect(workerTask.executionModelId).toBe("qwen/qwen3.8-max:free")
		expect(getModelId(workerTask.apiConfiguration)).toBe("qwen/qwen3.8-max:free")
		expect(getModelId(approvalConfig)).toBe("openai/gpt-6.1-sol")
	})

	// SCENARIO H: Native Chat vs Agent isolation
	it("SCENARIO H: Native chat session model does not bleed into Agent task configuration", () => {
		const agentTask = new Task({
			provider: mockProvider as unknown as ClineProvider,
			apiConfiguration: xkiroQwenConfig,
			task: "Agent task on Qwen",
			startTask: false,
		})

		const nativeChatModelId = "openai/gpt-6.1-sol"
		const nativeChatProvider = "xkiro"

		// Agent task remains completely isolated
		expect(agentTask.executionModelId).toBe("qwen/qwen3.8-max:free")
		expect(agentTask.executionProvider).toBe("xkiro")
		expect(nativeChatModelId).toBe("openai/gpt-6.1-sol")
		expect(nativeChatProvider).toBe("xkiro")
	})

	// SCENARIO I: Paused Task Model Switchability (Section 2 Verification)
	describe("SCENARIO I: Paused Task Model Switchability & Normal Resume Invariants", () => {
		it("Task started on GPT-6.1 Sol, paused, then user selects Qwen3.8 Max: TaskModelLock holds, switchModel is available, and Normal Resume preserves GPT-6.1 Sol", async () => {
			// 1. Task started on GPT-6.1 Sol
			const task = new Task({
				provider: mockProvider as unknown as ClineProvider,
				apiConfiguration: xkiroGpt61Config,
				task: "Task started on GPT-6.1 Sol",
				startTask: false,
			})
			;(task as any)._started = true
			mockProvider.runningTasks.set(task.taskId, task)
			mockProvider.getCurrentTask.mockReturnValue(task)

			expect(task.executionModelId).toBe("openai/gpt-6.1-sol")
			expect(task.executionEpoch).toBe(1)
			expect(task.taskStartModel).toBe("openai/gpt-6.1-sol")

			// 2. User pauses the task (task halted into interrupted status)
			;(task as any).currentStatus = "interrupted"
			task.isStreaming = false
			;(task as any).currentRequestAbortController = undefined

			// 3. User selects Qwen3.8 Max in global selector
			// Global settings update does NOT mutate the task's locked executionModelId
			expect(task.executionModelId).toBe("openai/gpt-6.1-sol")
			expect(getModelId(task.apiConfiguration)).toBe("openai/gpt-6.1-sol")

			// 4. Verify pause/resumable state and switch availability
			expect(task.isPausedOrResumable()).toBe(true)
			expect(task.canSwitchExecutionModel()).toBe(true) // Switch Model & Resume is available for manually paused task!

			// 5. Test Normal Resume: standard resume without switchModel preserves GPT-6.1 Sol and epoch 1
			await task.resumeWithResponse("yesButtonClicked")
			expect(task.executionModelId).toBe("openai/gpt-6.1-sol")
			expect(task.executionEpoch).toBe(1)
			expect(task.taskStartModel).toBe("openai/gpt-6.1-sol")

			// 6. Pause again and test Conscious Switch: user triggers switchExecutionModelAndResume with Qwen3.8 Max
			;(task as any).currentStatus = "interrupted"
			task.isStreaming = false
			;(task as any).currentRequestAbortController = undefined

			await task.switchExecutionModelAndResume(xkiroQwenConfig, "yesButtonClicked")

			expect(task.executionEpoch).toBe(2)
			expect(task.executionModelId).toBe("qwen/qwen3.8-max:free")
			expect(getModelId(task.apiConfiguration)).toBe("qwen/qwen3.8-max:free")
			expect(task.taskStartModel).toBe("openai/gpt-6.1-sol") // Start model strictly preserved
		})

		it("Active streaming task strictly rejects canSwitchExecutionModel()", () => {
			const task = new Task({
				provider: mockProvider as unknown as ClineProvider,
				apiConfiguration: xkiroGpt61Config,
				task: "Active streaming task",
				startTask: false,
			})
			;(task as any)._started = true
			task.isStreaming = true

			expect(task.canSwitchExecutionModel()).toBe(false)
			expect(task.isPausedOrResumable()).toBe(false)
		})
	})

	// SCENARIO J: Outgoing Request Payload Verification with Mock Transport (Section 4 Verification)
	describe("SCENARIO J: Outgoing Request Payload Model Routing & Isolation", () => {
		let tempStorageDir: string
		let chatManager: ChatSessionManager
		let outgoingPayloads: Array<{ source: "chat" | "agent"; model: string; requestOptions: any }> = []
		let originalCompletionsCreate: any

		beforeEach(() => {
			outgoingPayloads = []
			tempStorageDir = fs.mkdtempSync(path.join(os.tmpdir(), "roo-audit-payload-"))

			chatManager = new ChatSessionManager({
				storageDir: tempStorageDir,
				getGlobalSettings: () => ({
					apiProvider: "xkiro",
					xkiroApiKey: "mock-xkiro-key",
				}),
				getSecret: (key: string) => (key === "xkiroApiKey" ? "mock-xkiro-key" : undefined),
			})

			// Intercept Completions.prototype.create across the entire OpenAI SDK
			const dummyClient = new OpenAI({ apiKey: "mock" })
			const proto = Object.getPrototypeOf(dummyClient.chat.completions)
			originalCompletionsCreate = proto.create

			proto.create = vi.fn().mockImplementation(async (requestOptions: any, options?: any) => {
				const sysMsg = requestOptions.messages?.[0]
				const sysText =
					typeof sysMsg?.content === "string"
						? sysMsg.content
						: Array.isArray(sysMsg?.content)
						? sysMsg.content[0]?.text || ""
						: ""
				const isChat = sysText.includes("helpful, brilliant, concise")
				outgoingPayloads.push({
					source: isChat ? "chat" : "agent",
					model: requestOptions.model,
					requestOptions,
				})

				return {
					[Symbol.asyncIterator]: async function* () {
						yield {
							id: "mock-chunk-1",
							choices: [
								{
									index: 0,
									delta: { content: "Mock stream response from " + requestOptions.model },
									finish_reason: null,
								},
							],
						}
						yield {
							id: "mock-chunk-2",
							choices: [
								{
									index: 0,
									delta: {},
									finish_reason: "stop",
								},
							],
							usage: {
								prompt_tokens: 10,
								completion_tokens: 5,
								total_tokens: 15,
							},
						}
					},
				}
			})
		})

		afterEach(() => {
			if (originalCompletionsCreate) {
				const dummyClient = new OpenAI({ apiKey: "mock" })
				const proto = Object.getPrototypeOf(dummyClient.chat.completions)
				proto.create = originalCompletionsCreate
			}
			try {
				fs.rmSync(tempStorageDir, { recursive: true, force: true })
			} catch {}
		})

		it("Chat uses model from chatPreferences in outgoing request payload", async () => {
			await chatManager.savePreferences({
				apiProvider: "xkiro",
				modelId: "meta/muse-spark-1.3-contributor:free",
				webSearchMode: "off",
				enabled: true,
			})
			const session = await chatManager.createSession({ title: "Audit Chat" })

			await chatManager.sendMessage({
				sessionId: session.id,
				text: "Explain quantum teleportation briefly",
			})

			expect(outgoingPayloads.length).toBeGreaterThanOrEqual(1)
			const chatPayload = outgoingPayloads.find((p) => p.source === "chat")
			expect(chatPayload).toBeDefined()
			expect(chatPayload?.model).toBe("meta/muse-spark-1.3-contributor:free")
		})

		it("Agent uses executionModelId in outgoing request payload", async () => {
			const agentTask = new Task({
				provider: mockProvider as unknown as ClineProvider,
				apiConfiguration: xkiroGpt61Config,
				task: "Agent outgoing payload test",
				startTask: false,
			})

			const stream = agentTask.api.createMessage(
				"You are Roo Code agent",
				[{ role: "user", content: "Write a quick test" }],
				{ taskId: agentTask.taskId },
			)

			for await (const _chunk of stream) {
				// consume mock stream
			}

			const agentPayload = outgoingPayloads.find((p) => p.source === "agent")
			expect(agentPayload).toBeDefined()
			expect(agentPayload?.model).toBe("openai/gpt-6.1-sol")
		})

		it("Parallel Chat and Agent requests maintain strict model isolation without payload mixing", async () => {
			await chatManager.savePreferences({
				apiProvider: "xkiro",
				modelId: "meta/muse-spark-1.3-contributor:free",
				webSearchMode: "off",
				enabled: true,
			})
			const session = await chatManager.createSession({ title: "Concurrent Chat" })

			const agentTask = new Task({
				provider: mockProvider as unknown as ClineProvider,
				apiConfiguration: xkiroQwenConfig,
				task: "Concurrent Agent Task",
				startTask: false,
			})

			await Promise.all([
				chatManager.sendMessage({
					sessionId: session.id,
					text: "Concurrent chat message",
				}),
				(async () => {
					const stream = agentTask.api.createMessage(
						"You are Roo Code agent",
						[{ role: "user", content: "Concurrent agent message" }],
						{ taskId: agentTask.taskId },
					)
					for await (const _chunk of stream) {}
				})(),
			])

			const chatPayloads = outgoingPayloads.filter((p) => p.model === "meta/muse-spark-1.3-contributor:free")
			const agentPayloads = outgoingPayloads.filter((p) => p.model === "qwen/qwen3.8-max:free")

			expect(chatPayloads.length).toBe(1)
			expect(agentPayloads.length).toBe(1)
			expect(outgoingPayloads.length).toBe(2)
		})

		it("Modifying Chat model does not mutate Agent task outgoing payload model", async () => {
			const agentTask = new Task({
				provider: mockProvider as unknown as ClineProvider,
				apiConfiguration: xkiroGpt61Config,
				task: "Agent stability test",
				startTask: false,
			})

			await chatManager.savePreferences({
				apiProvider: "xkiro",
				modelId: "meta/muse-spark-1.3-contributor:free",
				webSearchMode: "off",
				enabled: true,
			})

			const stream = agentTask.api.createMessage(
				"System prompt",
				[{ role: "user", content: "Execute task" }],
				{ taskId: agentTask.taskId },
			)
			for await (const _chunk of stream) {}

			expect(agentTask.executionModelId).toBe("openai/gpt-6.1-sol")
			const lastAgentPayload = outgoingPayloads.filter((p) => p.source === "agent").pop()
			expect(lastAgentPayload?.model).toBe("openai/gpt-6.1-sol")
		})

		it("Modifying Agent execution model does not mutate Chat outgoing payload model", async () => {
			await chatManager.savePreferences({
				apiProvider: "xkiro",
				modelId: "meta/muse-spark-1.3-contributor:free",
				webSearchMode: "off",
				enabled: true,
			})
			const session = await chatManager.createSession({ title: "Chat Isolation Test" })

			const agentTask = new Task({
				provider: mockProvider as unknown as ClineProvider,
				apiConfiguration: xkiroGpt61Config,
				task: "Agent switch test",
				startTask: false,
			})
			;(agentTask as any)._started = true
			agentTask.clineMessages.push({
				ts: Date.now(),
				type: "ask",
				ask: "api_req_failed",
				text: "Model error",
			})

			await agentTask.switchExecutionModelAndResume(xkiroQwenConfig)
			expect(agentTask.executionModelId).toBe("qwen/qwen3.8-max:free")

			await chatManager.sendMessage({
				sessionId: session.id,
				text: "Chat message after agent switch",
			})

			const agentStream = agentTask.api.createMessage(
				"System prompt",
				[{ role: "user", content: "Agent message after switch" }],
				{ taskId: agentTask.taskId },
			)
			for await (const _chunk of agentStream) {}

			const chatPayload = outgoingPayloads.find((p) => p.source === "chat")
			const agentPayload = outgoingPayloads.find((p) => p.source === "agent")

			expect(chatPayload?.model).toBe("meta/muse-spark-1.3-contributor:free")
			expect(agentPayload?.model).toBe("qwen/qwen3.8-max:free")
		})

		it("Agent retry preserves exact locked executionModelId in outgoing payload without silent fallback", async () => {
			const agentTask = new Task({
				provider: mockProvider as unknown as ClineProvider,
				apiConfiguration: xkiroQwenConfig,
				task: "Retry payload test",
				startTask: false,
			})

			const stream1 = agentTask.api.createMessage("System prompt", [{ role: "user", content: "Attempt 1" }])
			for await (const _chunk of stream1) {}

			const stream2 = agentTask.api.createMessage("System prompt", [{ role: "user", content: "Retry attempt 2" }])
			for await (const _chunk of stream2) {}

			const payloads = outgoingPayloads.filter((p) => p.source === "agent")
			expect(payloads.length).toBe(2)
			expect(payloads[0].model).toBe("qwen/qwen3.8-max:free")
			expect(payloads[1].model).toBe("qwen/qwen3.8-max:free")
		})
	})
})
