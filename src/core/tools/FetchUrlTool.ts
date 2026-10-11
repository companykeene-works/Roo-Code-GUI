import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import { WebSearchService } from "../../services/web-search/WebSearchService"
import type { FetchUrlParams } from "@roo-code/types"

export class FetchUrlTool extends BaseTool<"fetch_url"> {
	readonly name = "fetch_url" as const

	async execute(params: FetchUrlParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { askApproval, pushToolResult } = callbacks
		const { url, max_chars } = params

		if (!url || typeof url !== "string" || !url.trim()) {
			task.consecutiveMistakeCount++
			task.didToolFailInCurrentTurn = true
			pushToolResult(await task.sayAndCreateMissingParamError("fetch_url", "url"))
			return
		}

		const sharedMessageProps = {
			tool: "fetchUrl",
			url: url.trim(),
		}

		const didApprove = await askApproval("tool", JSON.stringify(sharedMessageProps))
		if (!didApprove) {
			pushToolResult(formatResponse.toolDenied())
			return
		}

		task.consecutiveMistakeCount = 0

		try {
			const webSearchService = WebSearchService.getInstance()
			const result = await webSearchService.fetchUrl(url.trim(), {
				maxChars: max_chars,
			})

			const header = result.title ? `Title: ${result.title}\nURL: ${result.finalUrl}\n\n` : `URL: ${result.finalUrl}\n\n`
			pushToolResult(`${header}${result.content}`)
		} catch (error: any) {
			task.didToolFailInCurrentTurn = true
			task.recordToolError("fetch_url")
			const errorMessage = error?.message || String(error)
			await task.say("error", `Failed to fetch URL ${url}: ${errorMessage}`)
			pushToolResult(formatResponse.toolError(`Failed to fetch URL: ${errorMessage}`))
		}
	}
}

export const fetchUrlTool = new FetchUrlTool()
