import { SearchBackend, SearchOptions, SearchResultItem } from "../types.js"

export class SearxngSearchBackend implements SearchBackend {
	public readonly name = "searxng"
	private baseUrl: string

	constructor(baseUrl: string) {
		this.baseUrl = baseUrl?.trim() || ""
	}

	public async search(query: string, options: SearchOptions = {}): Promise<SearchResultItem[]> {
		if (!this.baseUrl) {
			throw new Error("SearXNG instance URL is missing. Please configure it in Settings -> Web Access.")
		}

		let cleanBaseUrl = this.baseUrl
		if (!cleanBaseUrl.startsWith("http://") && !cleanBaseUrl.startsWith("https://")) {
			cleanBaseUrl = `https://${cleanBaseUrl}`
		}
		cleanBaseUrl = cleanBaseUrl.replace(/\/+$/, "")

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
		const searchUrl = new URL(`${cleanBaseUrl}/search`)
		searchUrl.searchParams.set("q", effectiveQuery)
		searchUrl.searchParams.set("format", "json")

		const response = await fetch(searchUrl.toString(), {
			method: "GET",
			headers: {
				Accept: "application/json",
				"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)",
			},
			signal: options.signal,
		})

		if (!response.ok) {
			if (response.status === 429) {
				throw new Error("SearXNG rate limit reached (HTTP 429). Please wait before trying again.")
			}
			throw new Error(`SearXNG search failed with HTTP ${response.status}: ${response.statusText}`)
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
				snippet: item.content || item.snippet || "",
				domain,
				publishedAt: item.publishedDate || item.published_date || undefined,
			}
		})
	}
}
