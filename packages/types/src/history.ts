import { z } from "zod"
import { queuedMessageSchema } from "./message.js"

/**
 * HistoryItem
 */

export const titleSourceSchema = z.enum(["generated_ai", "manual", "fallback"])
export type TitleSource = z.infer<typeof titleSourceSchema>

export const taskBlockerStateSchema = z.object({
	blockKind: z.enum([
		"recoverable",
		"user_action_required",
		"hard_blocked",
		"safety_boundary",
		"permission_denied",
		"missing_dependency",
		"external_resource",
		"platform_constraint",
	]),
	blockReason: z.string(),
	evidence: z.string().optional(),
	requiredUnblockAction: z.string().optional(),
	blockedAt: z.number().optional(),
})
export type TaskBlockerState = z.infer<typeof taskBlockerStateSchema>

export const historyItemStatusSchema = z.enum(["active", "completed", "delegated", "cancelled", "failed", "interrupted", "blocked"])
export type HistoryItemStatus = z.infer<typeof historyItemStatusSchema>

export const historyItemSchema = z.object({
	id: z.string(),
	rootTaskId: z.string().optional(),
	parentTaskId: z.string().optional(),
	number: z.number(),
	createdAt: z.number().optional(),
	ts: z.number(),
	task: z.string(),
	title: z.string().optional(),
	titleSource: titleSourceSchema.optional(),
	tokensIn: z.number(),
	tokensOut: z.number(),
	cacheWrites: z.number().optional(),
	cacheReads: z.number().optional(),
	totalCost: z.number(),
	size: z.number().optional(),
	workspace: z.string().optional(),
	mode: z.string().optional(),
	apiConfigName: z.string().optional(), // Provider profile name for sticky profile feature
	status: historyItemStatusSchema.optional(),
	needsAttention: z.boolean().optional(),
	taskBlockerState: taskBlockerStateSchema.optional(),
	isBlockedOutcome: z.boolean().optional(),
	chatModelId: z.string().optional(),
	chatProvider: z.string().optional(),
	chatReasoningEffort: z.string().optional(),
	executionModelId: z.string().optional(),
	executionProvider: z.string().optional(),
	executionReasoningEffort: z.string().optional(),
	promptQueue: z.array(queuedMessageSchema).optional(),
	delegatedToId: z.string().optional(), // Last child this parent delegated to
	childIds: z.array(z.string()).optional(), // All children spawned by this task
	awaitingChildId: z.string().optional(), // Child currently awaited (set when delegated)
	completedByChildId: z.string().optional(), // Child that completed and resumed this parent
	completionResultSummary: z.string().optional(), // Summary from completed child
	hasUnread: z.boolean().optional(),
	lastReadTs: z.number().optional(),
	lastAssistantMessageTs: z.number().optional(),
})

export type HistoryItem = z.infer<typeof historyItemSchema>
