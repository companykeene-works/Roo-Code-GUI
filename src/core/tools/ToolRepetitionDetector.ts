import stringify from "safe-stable-stringify"
import { ToolUse } from "../../shared/tools"
import { t } from "../../i18n"

const DIAGNOSTIC_READ_ONLY_TOOLS = new Set([
	"read_file",
	"list_files",
	"codebase_search",
	"search_files",
	"web_search",
	"fetch_url",
])

export interface CommandIntent {
	isDelay: boolean
	canonicalKey?: string
}

/**
 * Classifies whether a CLI command is a pure delay / pseudo-sleep mechanism
 * (e.g. loopback ping, timeout, sleep, Start-Sleep).
 *
 * Crucially preserves legitimate network diagnostic commands (e.g. `ping google.com` or `ping 8.8.8.8`).
 */
export function classifyCommandIntent(rawCommand: string): CommandIntent {
	if (!rawCommand || typeof rawCommand !== "string") {
		return { isDelay: false }
	}

	const cmd = rawCommand.trim()

	// 1. Loopback ping delay idioms:
	// Pinging 127.0.0.1, localhost, ::1, or 0.0.0.0 is used as a makeshift sleep in batch scripts.
	const hasLoopbackPing = /(?:^|[;&|])\s*ping(?:\.exe)?\b.*?(?:127\.0\.0\.1|localhost|0\.0\.0\.0|::1)(?:\s|$|[;&|>])/i.test(cmd)
	if (hasLoopbackPing) {
		return { isDelay: true, canonicalKey: "execute_command:wait_delay" }
	}

	// 2. timeout command (cmd.exe):
	const hasTimeout = /(?:^|[;&|])\s*timeout(?:\.exe)?(?:\s+\/t)?\s+\d+/i.test(cmd)
	if (hasTimeout) {
		return { isDelay: true, canonicalKey: "execute_command:wait_delay" }
	}

	// 3. sleep command (POSIX / bash):
	const hasSleep = /(?:^|[;&|])\s*(?:\/bin\/|\/usr\/bin\/)?sleep\s+\d+/i.test(cmd)
	if (hasSleep) {
		return { isDelay: true, canonicalKey: "execute_command:wait_delay" }
	}

	// 4. Start-Sleep (PowerShell):
	const hasStartSleep = /(?:^|[;&|\s])(?:powershell(?:\.exe)?\s+(?:-Command|-c)\s+["']?)?Start-Sleep\b/i.test(cmd)
	if (hasStartSleep) {
		return { isDelay: true, canonicalKey: "execute_command:wait_delay" }
	}

	return { isDelay: false }
}

function extractCommandString(toolUse: ToolUse): string {
	if (typeof toolUse.params === "string") {
		try {
			const parsed = JSON.parse(toolUse.params)
			if (typeof parsed?.command === "string") {
				return parsed.command
			}
		} catch {}
	} else if (toolUse.params && typeof toolUse.params === "object") {
		const cmd = (toolUse.params as Record<string, unknown>).command
		if (typeof cmd === "string") {
			return cmd
		}
	}
	if (toolUse.nativeArgs && typeof toolUse.nativeArgs === "object") {
		const cmd = (toolUse.nativeArgs as Record<string, unknown>).command
		if (typeof cmd === "string") {
			return cmd
		}
	}
	return ""
}

/**
 * Class for detecting consecutive identical tool calls
 * to prevent the AI from getting stuck in a loop.
 */
export class ToolRepetitionDetector {
	private previousToolCallJson: string | null = null
	private consecutiveIdenticalToolCallCount: number = 0
	private readonly consecutiveIdenticalToolCallLimit: number

	private previousMutatingToolCallJson: string | null = null
	private consecutiveIdenticalMutatingToolCallCount: number = 0

	private hasWarnedInCurrentTurn: boolean = false
	private executedWaitsThisTurn: number = 0

	/**
	 * Creates a new ToolRepetitionDetector
	 * @param limit The maximum number of identical consecutive tool calls allowed
	 */
	constructor(limit: number = 3) {
		this.consecutiveIdenticalToolCallLimit = limit
	}

	/**
	 * Resets all repetition counts and history.
	 */
	public reset(): void {
		this.consecutiveIdenticalToolCallCount = 0
		this.consecutiveIdenticalMutatingToolCallCount = 0
		this.previousToolCallJson = null
		this.previousMutatingToolCallJson = null
	}

	/**
	 * Resets turn-scoped tracking at turn boundaries.
	 */
	public resetTurnBoundary(): void {
		this.hasWarnedInCurrentTurn = false
		this.executedWaitsThisTurn = 0
	}

	/**
	 * Marks that a repetition warning was presented to the user during the current turn.
	 */
	public markTurnWarned(): void {
		this.hasWarnedInCurrentTurn = true
	}

	/**
	 * Checks if a warning has already been presented and handled in the current turn.
	 */
	public isTurnSuppressed(): boolean {
		return this.hasWarnedInCurrentTurn
	}

	/**
	 * Records that a wait command executed in the current turn.
	 */
	public recordWaitExecuted(): void {
		this.executedWaitsThisTurn++
	}

	/**
	 * Checks if a command or tool use represents a pure delay / wait mechanism.
	 */
	public isDelayCommand(toolUseOrCommand: ToolUse | string): boolean {
		const commandStr =
			typeof toolUseOrCommand === "string" ? toolUseOrCommand : extractCommandString(toolUseOrCommand)
		return classifyCommandIntent(commandStr).isDelay
	}

	/**
	 * Determines if a tool call is a redundant wait in the same assistant turn.
	 * If a wait command already executed in this turn, redundant subsequent waits
	 * should be skipped before shell execution.
	 */
	public isRedundantSameTurnWait(toolUse: ToolUse): boolean {
		if (toolUse.name !== "execute_command") {
			return false
		}
		return this.isDelayCommand(toolUse) && this.executedWaitsThisTurn > 0
	}

	/**
	 * Checks if the current tool call is identical to the previous one
	 * and determines if execution should be allowed
	 *
	 * @param currentToolCallBlock ToolUse object representing the current tool call
	 * @returns Object indicating if execution is allowed and a message to show if not
	 */
	public check(currentToolCallBlock: ToolUse): {
		allowExecution: boolean
		askUser?: {
			messageKey: string
			messageDetail: string
		}
	} {
		// Serialize the block to a canonical JSON string for comparison
		const currentToolCallJson = this.serializeToolUse(currentToolCallBlock)
		const isDiagnosticTool = DIAGNOSTIC_READ_ONLY_TOOLS.has(currentToolCallBlock.name)

		// Compare with immediately previous tool call
		if (this.previousToolCallJson === currentToolCallJson) {
			this.consecutiveIdenticalToolCallCount++
		} else {
			this.consecutiveIdenticalToolCallCount = 0 // Reset to 0 for a new tool
			this.previousToolCallJson = currentToolCallJson
		}

		// Also compare against previous mutating tool call if current call is not diagnostic
		if (!isDiagnosticTool) {
			if (this.previousMutatingToolCallJson === currentToolCallJson) {
				this.consecutiveIdenticalMutatingToolCallCount++
			} else {
				this.consecutiveIdenticalMutatingToolCallCount = 0
				this.previousMutatingToolCallJson = currentToolCallJson
			}
		}

		// Check if limit is reached (0 means unlimited)
		if (
			this.consecutiveIdenticalToolCallLimit > 0 &&
			(this.consecutiveIdenticalToolCallCount >= this.consecutiveIdenticalToolCallLimit ||
				this.consecutiveIdenticalMutatingToolCallCount >= this.consecutiveIdenticalToolCallLimit)
		) {
			// Reset counters to allow recovery if user guides the AI past this point
			this.consecutiveIdenticalToolCallCount = 0
			this.consecutiveIdenticalMutatingToolCallCount = 0
			this.previousToolCallJson = null
			this.previousMutatingToolCallJson = null

			// Return result indicating execution should not be allowed
			return {
				allowExecution: false,
				askUser: {
					messageKey: "mistake_limit_reached",
					messageDetail: t("tools:toolRepetitionLimitReached", { toolName: currentToolCallBlock.name }),
				},
			}
		}

		// Execution is allowed
		return { allowExecution: true }
	}

	/**
	 * Serializes a ToolUse object into a canonical JSON string for comparison.
	 * Pure delay commands (ping localhost, timeout, sleep, Start-Sleep) are canonicalized
	 * so varying parameters (e.g. ping -n 45 vs ping -n 46) share the same repetition fingerprint.
	 *
	 * @param toolUse The ToolUse object to serialize
	 * @returns JSON string representation of the tool use with sorted parameter keys
	 */
	private serializeToolUse(toolUse: ToolUse): string {
		if (toolUse.name === "execute_command") {
			const command = extractCommandString(toolUse)
			const intent = classifyCommandIntent(command)
			if (intent.isDelay) {
				return (
					stringify({
						name: "execute_command",
						intent: "wait_delay",
					}) ?? ""
				)
			}
		}

		const toolObject: Record<string, any> = {
			name: toolUse.name,
			params: toolUse.params,
		}

		// Only include nativeArgs if it has content
		if (toolUse.nativeArgs && Object.keys(toolUse.nativeArgs).length > 0) {
			toolObject.nativeArgs = toolUse.nativeArgs
		}

		return stringify(toolObject) ?? ""
	}
}
