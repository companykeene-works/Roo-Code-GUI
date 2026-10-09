// npx vitest src/core/assistant-message/__tests__/presentAssistantMessage-repetition.spec.ts

import { describe, it, expect, beforeEach, vi } from "vitest"
import { presentAssistantMessage } from "../presentAssistantMessage"

// Mock dependencies
vi.mock("../../task/Task")
vi.mock("../../tools/validateToolUse", () => ({
	validateToolUse: vi.fn(),
	isValidToolName: vi.fn(() => true),
}))
vi.mock("../tools/filter-tools-for-mode", () => ({
	resolveToolAlias: vi.fn((tool: string) => tool),
}))

describe("presentAssistantMessage - Repetition & Same-Turn Wait Handling", () => {
	let mockTask: any

	beforeEach(() => {
		mockTask = {
			taskId: "test-task-repetition",
			instanceId: "test-instance",
			abort: false,
			abortRemainingToolCalls: false,
			presentAssistantMessageLocked: false,
			presentAssistantMessageHasPendingUpdates: false,
			currentStreamingContentIndex: 0,
			assistantMessageContent: [],
			userMessageContent: [],
			didCompleteReadingStream: true,
			didRejectTool: false,
			didAlreadyUseTool: false,
			consecutiveMistakeCount: 0,
			clineMessages: [],
			api: {
				getModel: () => ({ id: "test-model", info: { includedTools: ["execute_command"] } }),
			},
			recordToolUsage: vi.fn(),
			recordToolError: vi.fn(),
			toolRepetitionDetector: {
				check: vi.fn().mockReturnValue({ allowExecution: true }),
				isRedundantSameTurnWait: vi.fn().mockReturnValue(false),
				isDelayCommand: vi.fn().mockReturnValue(false),
				recordWaitExecuted: vi.fn(),
				isTurnSuppressed: vi.fn().mockReturnValue(false),
				markTurnWarned: vi.fn(),
				reset: vi.fn(),
			},
			providerRef: {
				deref: () => ({
					getState: vi.fn().mockResolvedValue({
						mode: "code",
						customModes: [],
					}),
				}),
			},
			say: vi.fn().mockResolvedValue(undefined),
			ask: vi.fn().mockResolvedValue({ response: "yesButtonClicked" }),
		}

		mockTask.pushToolResultToUserContent = vi.fn().mockImplementation((toolResult: any) => {
			const existingResult = mockTask.userMessageContent.find(
				(block: any) => block.type === "tool_result" && block.tool_use_id === toolResult.tool_use_id,
			)
			if (existingResult) {
				return false
			}
			mockTask.userMessageContent.push(toolResult)
			return true
		})
	})

	it("should abort subsequent tool calls when repetition limit is reached and user clicks Proceed Anyways", async () => {
		mockTask.toolRepetitionDetector.check
			.mockReturnValueOnce({
				allowExecution: false,
				askUser: {
					messageKey: "mistake_limit_reached",
					messageDetail: "Roo appears to be stuck in a loop with execute_command",
				},
			})
			.mockReturnValue({ allowExecution: true })

		mockTask.assistantMessageContent = [
			{
				type: "tool_use",
				id: "call_1",
				name: "execute_command",
				params: { command: "ping -n 46 127.0.0.1 >nul" },
				nativeArgs: { command: "ping -n 46 127.0.0.1 >nul" },
				partial: false,
			},
			{
				type: "tool_use",
				id: "call_2",
				name: "execute_command",
				params: { command: "ping -n 46 127.0.0.1 >nul" },
				nativeArgs: { command: "ping -n 46 127.0.0.1 >nul" },
				partial: false,
			},
		]

		await presentAssistantMessage(mockTask)

		// Verify ask was triggered once
		expect(mockTask.ask).toHaveBeenCalledTimes(1)
		expect(mockTask.toolRepetitionDetector.markTurnWarned).toHaveBeenCalledTimes(1)
		expect(mockTask.toolRepetitionDetector.reset).toHaveBeenCalledTimes(1)

		// Verify user feedback was recorded
		expect(mockTask.say).toHaveBeenCalledWith("user_feedback", expect.stringContaining("Proceed Anyways"))

		// Verify call_1 has error tool_result
		const result1 = mockTask.userMessageContent.find((item: any) => item.tool_use_id === "call_1")
		expect(result1).toBeDefined()
		expect(result1.content).toContain("repetition limit reached")

		// Verify call_2 was aborted and skipped (with tool_result for API protocol integrity)
		const result2 = mockTask.userMessageContent.find((item: any) => item.tool_use_id === "call_2")
		expect(result2).toBeDefined()
		expect(result2.is_error).toBe(true)
		expect(result2.content).toContain("repetition limit was reached in this turn")
	})

	it("should skip redundant same-turn wait commands without executing shell", async () => {
		mockTask.toolRepetitionDetector.isRedundantSameTurnWait.mockReturnValue(true)

		mockTask.assistantMessageContent = [
			{
				type: "tool_use",
				id: "call_redundant_ping",
				name: "execute_command",
				params: { command: "ping -n 46 127.0.0.1 >nul" },
				nativeArgs: { command: "ping -n 46 127.0.0.1 >nul" },
				partial: false,
			},
		]

		await presentAssistantMessage(mockTask)

		// Verify redundant wait tool_result was emitted immediately
		const result = mockTask.userMessageContent.find((item: any) => item.tool_use_id === "call_redundant_ping")
		expect(result).toBeDefined()
		expect(result.content).toContain("Redundant wait skipped")

		// Verify ask was NOT called
		expect(mockTask.ask).not.toHaveBeenCalled()
	})

	it("should suppress secondary warnings within the same turn when turn is already warned", async () => {
		mockTask.toolRepetitionDetector.check.mockReturnValue({
			allowExecution: false,
			askUser: {
				messageKey: "mistake_limit_reached",
				messageDetail: "Loop detected",
			},
		})
		mockTask.toolRepetitionDetector.isTurnSuppressed.mockReturnValue(true)

		mockTask.assistantMessageContent = [
			{
				type: "tool_use",
				id: "call_suppressed",
				name: "execute_command",
				params: { command: "ping -n 46 127.0.0.1 >nul" },
				nativeArgs: { command: "ping -n 46 127.0.0.1 >nul" },
				partial: false,
			},
		]

		await presentAssistantMessage(mockTask)

		// User prompt should NOT be asked again
		expect(mockTask.ask).not.toHaveBeenCalled()

		// Tool result should report suppression
		const result = mockTask.userMessageContent.find((item: any) => item.tool_use_id === "call_suppressed")
		expect(result).toBeDefined()
		expect(result.content).toContain("suppressed within current turn")
	})
})
