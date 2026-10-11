import type OpenAI from "openai"

const WEB_SEARCH_DESCRIPTION = `Search the live internet for current information, documentation, package releases, API changes, error messages, or technical references.

Use web_search when:
- Current or latest information matters (recent library releases, breaking changes, live documentation).
- The user explicitly asks to search, look up, research, or verify information online.
- When web search is REQUIRED for this turn (e.g. indicated by the user or web search mode), you MUST perform at least one relevant web_search before completing the turn with attempt_completion.
- The local repository does not contain necessary external documentation or specifications.
- Exact current API or third-party behavior needs verification.

Do NOT search when:
- The answer is already present in the local codebase or files.
- The user asks not to search or browse online.
- The required information is already available in previous tool results in this conversation.

Parameters:
- query: (required) Specific search query keywords or phrase.
- allowed_domains: (optional) Array of domains to restrict results to (e.g. ["docs.rs", "github.com"]).
- excluded_domains: (optional) Array of domains to exclude from results.
- max_results: (optional) Maximum results to return (1-20, default 5).`

export default {
	type: "function",
	function: {
		name: "web_search",
		description: WEB_SEARCH_DESCRIPTION,
		strict: false,
		parameters: {
			type: "object",
			properties: {
				query: {
					type: "string",
					description: "The search query keywords or phrase to look up on the web.",
				},
				allowed_domains: {
					type: "array",
					items: { type: "string" },
					description: "Optional list of domains to limit search to (e.g. ['developer.mozilla.org']).",
				},
				excluded_domains: {
					type: "array",
					items: { type: "string" },
					description: "Optional list of domains to exclude from search results.",
				},
				max_results: {
					type: "number",
					description: "Maximum number of search results to return (default 5).",
				},
			},
			required: ["query"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
