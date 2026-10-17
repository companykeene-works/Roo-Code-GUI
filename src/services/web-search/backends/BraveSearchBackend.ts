import { SearchBackend, SearchOptions, SearchResultItem } from "../types.js"

export class BraveSearchBackend implements SearchBackend {
	public readonly name = "brave"
	private apiKey: string

	constructor(apiKey: string) {
		this.apiKey = apiKey
	}

	public async search(query: string, options: SearchOptions = {}): Promise<SearchResultItem[]> {
		if (!this.apiKey) {
			throw new Error("Brave Search API key is missing. Please configure it in Settings -> Web Access.")
		}

		let effectiveQuery = query.trim()
		if (options.allowedDomains && options.allowedDomains.length > 0) {
			const domainFilter = options.allowedDomains.map((d) => `site:${d.trim()}`).join(" OR ")
			effectiveQuery = `${effectiveQuery} (${domainFilter})`
		}
		if (options.excludedDomains && options.excludedDomains.length > 0) {
			const excludeFilter = options.excludedDomains.map((d) => `-site:${d.trim()}`).join(" ")
			effectiveQuery = `${effectiveQuery} ${excludeFilter}`
		}

		const count = Math.min(options.maxResults ?? 5, 20)
		const searchUrl = new URL("https://api.search.brave.com/res/v1/web/search")
		searchUrl.searchParams.set("q", effectiveQuery)
		searchUrl.searchParams.set("count", String(count))

		const response = await fetch(searchUrl.toString(), {
			method: "GET",
			headers: {
				Accept: "application/json",
				"Accept-Encoding": "gzip",
				"X-Subscription-Token": this.apiKey,
			},
			signal: options.signal,
		})

		if (!response.ok) {
			if (response.status === 429) {
				throw new Error("Brave Search rate limit reached (HTTP 429). Please wait before trying again.")
			}
			if (response.status === 401 || response.status === 403) {
				throw new Error("Brave Search authentication failed (HTTP 401/403). Please verify your API key.")
			}
			throw new Error(`Brave Search failed with HTTP ${response.status}: ${response.statusText}`)
		}

		const data = (await response.json()) as any
		const rawResults: any[] = data.web?.results || []

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
				snippet: item.description || "",
				domain,
				publishedAt: item.age || item.page_age || undefined,
			}
		})
	}
}
