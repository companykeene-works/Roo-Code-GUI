import { SearchBackend, SearchOptions, SearchResultItem } from "../types.js"

export class TavilySearchBackend implements SearchBackend {
	public readonly name = "tavily"
	private apiKey: string

	constructor(apiKey: string) {
		this.apiKey = apiKey
	}

	public async search(query: string, options: SearchOptions = {}): Promise<SearchResultItem[]> {
		if (!this.apiKey) {
			throw new Error("Tavily API key is missing. Please configure it in Settings -> Web Access.")
		}

		const count = Math.min(options.maxResults ?? 5, 20)
		const payload: Record<string, any> = {
			api_key: this.apiKey,
			query: query.trim(),
			max_results: count,
		}

		if (options.allowedDomains && options.allowedDomains.length > 0) {
			payload.include_domains = options.allowedDomains
		}
		if (options.excludedDomains && options.excludedDomains.length > 0) {
			payload.exclude_domains = options.excludedDomains
		}

		const response = await fetch("https://api.tavily.com/search", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json",
			},
			body: JSON.stringify(payload),
		})

		if (!response.ok) {
			if (response.status === 429) {
				throw new Error("Tavily rate limit reached (HTTP 429). Please wait before trying again.")
			}
			if (response.status === 401 || response.status === 403) {
				throw new Error("Tavily authentication failed (HTTP 401/403). Please verify your API key.")
			}
			throw new Error(`Tavily search failed with HTTP ${response.status}: ${response.statusText}`)
		}

		const data = (await response.json()) as any
		const rawResults: any[] = data.results || []

		return rawResults.slice(0, count).map((item) => {
			let domain = ""
			try {
				domain = new URL(item.url).hostname
			} catch {
				domain = ""
			}

			return {
				title: item.title || "",
				url: item.url || "",
				snippet: item.content || item.raw_content || "",
				domain,
				publishedAt: item.published_date || undefined,
			}
		})
	}
}
