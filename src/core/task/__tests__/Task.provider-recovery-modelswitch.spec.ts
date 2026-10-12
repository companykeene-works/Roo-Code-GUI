import * as vscode from "vscode"
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { ProviderSettings } from "@roo-code/types"
import { Task } from "../Task"
import { ClineProvider } from "../../webview/ClineProvider"
import { RooCodeEventName } from "@roo-code/types"

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

describe("Task - Provider Recovery Model Switching Architecture", () => {
	// Incident context: task 01a1308d-9787-759d-bcf2-381f18d8add8
	const qwenConfig: ProviderSettings = {
		apiProvider: "xkiro",
		openAiModelId: "qwen/qwen3.8-max:free",
		apiKey: "test-xkiro-key",
		reasoningEffort: "high",
	} as any

	const gptConfig: ProviderSettings = {
		apiProvider: "openai",
		openAiModelId: "openai/gpt-6.1-sol",
		openAiApiKey: "test-openai-key",
		reasoningEffort: "medium",
	} as any

	const museConfig: ProviderSettings = {
		apiProvider: "xkiro",
		openAiModelId: "meta/muse-spark-1.3-contributor:free",
		apiKey: "test-xkiro-key",
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
				apiConfiguration: qwenConfig,
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

	it("INCIDENT REPRODUCTION: Capacity outage on Qwen allows explicit recovery switch to GPT, creates epoch 2, preserves initial snapshot, and resets circuit breaker", async () => {
		const task = new Task({
			provider: mockProvider as unknown as ClineProvider,
			apiConfiguration: qwenConfig,
			task: "Investigate capacity outage recovery",
			startTask: false,
		})
		;(task as any)._started = true

		mockProvider.runningTasks.set(task.taskId, task)
		mockProvider.getCurrentTask.mockReturnValue(task)

		// Initial state verification
		expect(task.executionEpoch).toBe(1)
		expect(task.executionModelId).toBe("qwen/qwen3.8-max:free")
		expect(task.executionProvider).toBe("xkiro")
		expect(task.taskStartModel).toBe("qwen/qwen3.8-max:free")

		// Simulate capacity outage halting execution: "This model is temporarily at capacity. Please try again shortly or use a different model."
		task.clineMessages.push({
			ts: Date.now(),
			type: "ask",
			ask: "api_req_failed",
			text: "This model is temporarily at capacity. Please try again shortly or use a different model.",
		})
		;(task as any).consecutiveIdenticalFailures = 3
		;(task as any).lastFailedRequestFingerprint = "qwen-hash-123"

		// Safe switch window must be open
		expect(task.isHaltedOnProviderError()).toBe(true)
		expect(task.canSwitchExecutionModel()).toBe(true)

		// User explicitly clicks "Switch model & Resume" with GPT
		await task.switchExecutionModelAndResume(gptConfig)

		// Execution epoch transitioned atomically
		expect(task.executionEpoch).toBe(2)
		expect(task.executionModelId).toBe("openai/gpt-6.1-sol")
		expect(task.executionProvider).toBe("openai")
		expect(task.api.getModel().id).toBe("openai/gpt-6.1-sol")

		// Invariant 4 preserved: taskStartModel is strictly immutable
		expect(task.taskStartModel).toBe("qwen/qwen3.8-max:free")

		// Circuit breaker reset for the new model epoch
		expect((task as any).consecutiveIdenticalFailures).toBe(0)
		expect((task as any).lastFailedRequestFingerprint).toBeUndefined()

		// History item metadata updated for UI and persistence
		expect(task.historyItem?.executionEpoch).toBe(2)
		expect(task.historyItem?.executionModelId).toBe("openai/gpt-6.1-sol")
		expect(task.historyItem?.chatModelId).toBe("openai/gpt-6.1-sol")
	})

	it("RUNNING TASK GUARD: Actively streaming task strictly disallows execution model switch", async () => {
		const task = new Task({
			provider: mockProvider as unknown as ClineProvider,
			apiConfiguration: qwenConfig,
			task: "Actively streaming task",
			startTask: false,
		})
		;(task as any)._started = true

		mockProvider.runningTasks.set(task.taskId, task)
		mockProvider.getCurrentTask.mockReturnValue(task)

		// Task is actively streaming
		task.isStreaming = true

		expect(task.canSwitchExecutionModel()).toBe(false)
		await expect(task.switchExecutionModelAndResume(gptConfig)).rejects.toThrow(
			"Cannot switch execution model",
		)

		// State must remain strictly unchanged
		expect(task.executionEpoch).toBe(1)
		expect(task.executionModelId).toBe("qwen/qwen3.8-max:free")
		expect(task.api.getModel().id).toBe("qwen/qwen3.8-max:free")
	})

	it("SAME MODEL RETRY: Standard retry without switching model preserves existing execution epoch", async () => {
		const task = new Task({
			provider: mockProvider as unknown as ClineProvider,
			apiConfiguration: qwenConfig,
			task: "Same model retry task",
			startTask: false,
		})
		;(task as any)._started = true

		// Provider error halt
		task.clineMessages.push({
			ts: Date.now(),
			type: "ask",
			ask: "api_req_failed",
			text: "Service Unavailable 503",
		})

		expect(task.canSwitchExecutionModel()).toBe(true)

		// User retries without switching model (standard resumeWithResponse)
		await task.resumeWithResponse("yesButtonClicked")

		// Epoch must NOT be incremented
		expect(task.executionEpoch).toBe(1)
		expect(task.executionModelId).toBe("qwen/qwen3.8-max:free")
		expect(task.taskStartModel).toBe("qwen/qwen3.8-max:free")
	})

	it("FAILED PRE-VALIDATION: Invalid target model config leaves task in current epoch without corruption", async () => {
		const task = new Task({
			provider: mockProvider as unknown as ClineProvider,
			apiConfiguration: qwenConfig,
			task: "Pre-validation task",
			startTask: false,
		})
		;(task as any)._started = true

		task.clineMessages.push({
			ts: Date.now(),
			type: "ask",
			ask: "api_req_failed",
			text: "Capacity outage",
		})

		const invalidConfig: ProviderSettings = {
			apiProvider: "openai",
			// Missing model ID
		} as any

		await expect(task.switchExecutionModelAndResume(invalidConfig)).rejects.toThrow()

		// State must not be corrupted
		expect(task.executionEpoch).toBe(1)
		expect(task.executionModelId).toBe("qwen/qwen3.8-max:free")
		expect(task.isHaltedOnProviderError()).toBe(true)
	})

	it("CROSS-CHAT ISOLATION: Model switch in halted Task A does not leak into concurrent Task B", async () => {
		const taskA = new Task({
			provider: mockProvider as unknown as ClineProvider,
			apiConfiguration: qwenConfig,
			task: "Task A - Halted",
			startTask: false,
		})
		;(taskA as any)._started = true

		const taskB = new Task({
			provider: mockProvider as unknown as ClineProvider,
			apiConfiguration: museConfig,
			task: "Task B - Running",
			startTask: false,
		})
		;(taskB as any)._started = true

		mockProvider.runningTasks.set(taskA.taskId, taskA)
		mockProvider.runningTasks.set(taskB.taskId, taskB)

		// Task A halts on provider failure
		taskA.clineMessages.push({
			ts: Date.now(),
			type: "ask",
			ask: "api_req_failed",
			text: "Capacity outage on Qwen",
		})

		// Task A recovers on GPT
		await taskA.switchExecutionModelAndResume(gptConfig)

		// Task A is now on GPT (epoch 2)
		expect(taskA.executionEpoch).toBe(2)
		expect(taskA.executionModelId).toBe("openai/gpt-6.1-sol")

		// Task B remains strictly on Muse (epoch 1) - ZERO cross-chat leakage
		expect(taskB.executionEpoch).toBe(1)
		expect(taskB.executionModelId).toBe("meta/muse-spark-1.3-contributor:free")
		expect(taskB.api.getModel().id).toBe("meta/muse-spark-1.3-contributor:free")
	})

	it("HISTORY PRESERVATION: switchExecutionModelAndResume preserves all conversational history and tool records", async () => {
		const task = new Task({
			provider: mockProvider as unknown as ClineProvider,
			apiConfiguration: qwenConfig,
			task: "Preserve history test",
			startTask: false,
		})
		;(task as any)._started = true

		// Add messages and tools before failure
		task.clineMessages.push(
			{ ts: 1000, type: "say", say: "task", text: "Original task" },
			{ ts: 2000, type: "say", say: "tool", text: JSON.stringify({ tool: "readFile", path: "test.ts" }) },
			{ ts: 3000, type: "ask", ask: "api_req_failed", text: "Capacity outage" },
		)
		task.apiConversationHistory.push({
			role: "user",
			content: "Initial user prompt",
		})

		await task.switchExecutionModelAndResume(gptConfig)

		// History is fully intact
		expect(task.clineMessages.length).toBe(3)
		expect(task.clineMessages[0].text).toBe("Original task")
		expect(task.clineMessages[1].say).toBe("tool")
		expect(task.apiConversationHistory.length).toBe(1)
		expect(task.apiConversationHistory[0].content).toBe("Initial user prompt")
	})

	it("REASONING EFFORT ADAPTATION: Switching to model without reasoning clears effort cleanly", async () => {
		const task = new Task({
			provider: mockProvider as unknown as ClineProvider,
			apiConfiguration: qwenConfig, // has reasoningEffort: "high"
			task: "Reasoning adaptation test",
			startTask: false,
		})
		;(task as any)._started = true

		task.clineMessages.push({
			ts: Date.now(),
			type: "ask",
			ask: "api_req_failed",
			text: "Outage",
		})

		const simpleModelConfig: ProviderSettings = {
			apiProvider: "openai",
			openAiModelId: "gpt-4o-mini",
			openAiApiKey: "test-openai-key",
			reasoningEffort: "high",
		} as any

		await task.switchExecutionModelAndResume(simpleModelConfig)

		expect(task.executionEpoch).toBe(2)
		expect(task.executionModelId).toBe("gpt-4o-mini")
		expect((task.apiConfiguration as any).reasoningEffort).toBeUndefined()
		expect(task.apiConfiguration.enableReasoningEffort).toBe(false)
	})
})
