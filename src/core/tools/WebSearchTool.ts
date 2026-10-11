import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import { WebSearchService } from "../../services/web-search/WebSearchService"
import { WebSearchServiceConfig } from "../../services/web-search/types"
import type { WebSearchParams } from "@roo-code/types"

export class WebSearchTool extends BaseTool<"web_search"> {
	readonly name = "web_search" as const

	async execute(params: WebSearchParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { askApproval, pushToolResult } = callbacks
		const { query, allowed_domains, excluded_domains, max_results } = params

		if (!query || typeof query !== "string" || !query.trim()) {
			task.consecutiveMistakeCount++
			task.didToolFailInCurrentTurn = true
			pushToolResult(await task.sayAndCreateMissingParamError("web_search", "query"))
			return
		}

		const sharedMessageProps = {
			tool: "webSearch",
			query: query.trim(),
		}

		const didApprove = await askApproval("tool", JSON.stringify(sharedMessageProps))
		if (!didApprove) {
			pushToolResult(formatResponse.toolDenied())
			return
		}

		task.consecutiveMistakeCount = 0

		try {
			const provider = task.providerRef.deref()
			const contextProxy = provider?.contextProxy
			const globalSettings = contextProxy?.getGlobalSettings()
			const apiKey = contextProxy?.getSecret("webSearchApiKey")

			const config: WebSearchServiceConfig = {
				enabled: globalSettings?.webSearchEnabled ?? true,
				provider: globalSettings?.webSearchProvider ?? "brave",
				apiKey: apiKey ?? "",
				searxngUrl: globalSettings?.webSearchSearxngUrl ?? "",
				maxResults: max_results ?? globalSettings?.webSearchMaxResults ?? 5,
			}

			const webSearchService = WebSearchService.getInstance()
			const results = await webSearchService.search(
				query,
				{
					allowedDomains: allowed_domains,
					excludedDomains: excluded_domains,
					maxResults: max_results,
				},
				config,
			)

			// Record successful search in this turn
			task.successfulWebSearchesInCurrentTurn++

			if (!results || results.length === 0) {
				pushToolResult(`No web search results found for query: "${query}"`)
				return
			}

			const formattedResults = results
				.map((item, index) => {
					const parts = [
						`[${index + 1}] ${item.title}`,
						`URL: ${item.url}`,
						`Domain: ${item.domain}`,
					]
					if (item.publishedAt) {
						parts.push(`Published: ${item.publishedAt}`)
					}
					parts.push(`Snippet: ${item.snippet}`)
					return parts.join("\n")
				})
				.join("\n\n---\n\n")

			pushToolResult(formattedResults)
		} catch (error: any) {
			task.didToolFailInCurrentTurn = true
			task.recordToolError("web_search")
			const errorMessage = error?.message || String(error)
			await task.say("error", `Web search failed: ${errorMessage}`)
			pushToolResult(formatResponse.toolError(`Web search could not be completed: ${errorMessage}`))
		}
	}
}

export const webSearchTool = new WebSearchTool()
