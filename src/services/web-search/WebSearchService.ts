import { BraveSearchBackend } from "./backends/BraveSearchBackend.js"
import { TavilySearchBackend } from "./backends/TavilySearchBackend.js"
import { SearxngSearchBackend } from "./backends/SearxngSearchBackend.js"
import { UrlFetcher } from "./UrlFetcher.js"
import {
	FetchUrlOptions,
	FetchUrlResult,
	SearchBackend,
	SearchOptions,
	SearchResultItem,
	WebSearchServiceConfig,
} from "./types.js"

const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes cache

interface CacheEntry {
	items: SearchResultItem[]
	timestamp: number
}

export class WebSearchService {
	private static instance: WebSearchService
	private urlFetcher: UrlFetcher
	private queryCache = new Map<string, CacheEntry>()

	constructor() {
		this.urlFetcher = new UrlFetcher()
	}

	public static getInstance(): WebSearchService {
		if (!WebSearchService.instance) {
			WebSearchService.instance = new WebSearchService()
		}
		return WebSearchService.instance
	}

	/**
	 * Checks whether the web search backend has sufficient configuration to execute searches.
	 */
	public isConfigured(config: WebSearchServiceConfig): boolean {
		if (!config.enabled) {
			return false
		}
		const provider = config.provider || "brave"
		if (provider === "searxng") {
			return Boolean(config.searxngUrl?.trim())
		}
		return Boolean(config.apiKey?.trim())
	}

	/**
	 * Creates a backend instance based on configuration.
	 */
	public getBackend(config: WebSearchServiceConfig): SearchBackend {
		const provider = config.provider || "brave"
		switch (provider) {
			case "tavily":
				return new TavilySearchBackend(config.apiKey || "")
			case "searxng":
				return new SearxngSearchBackend(config.searxngUrl || "")
			case "brave":
			default:
				return new BraveSearchBackend(config.apiKey || "")
		}
	}

	/**
	 * Executes a web search with turn-level caching and retry on transient rate limits.
	 */
	public async search(
		query: string,
		options: SearchOptions = {},
		config: WebSearchServiceConfig = {},
	): Promise<SearchResultItem[]> {
		if (config.enabled === false) {
			throw new Error("Web access is disabled in settings. Enable it in Settings -> Web Access.")
		}

		const trimmedQuery = query.trim()
		if (!trimmedQuery) {
			throw new Error("Search query cannot be empty.")
		}

		const backend = this.getBackend(config)
		const cacheKey = JSON.stringify({
			backend: backend.name,
			query: trimmedQuery.toLowerCase(),
			options,
		})

		const cached = this.queryCache.get(cacheKey)
		if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
			return cached.items
		}

		// Execute with 1 retry on 429 rate limit
		let attempts = 0
		let lastError: any = null

		while (attempts < 2) {
			try {
				attempts++
				const results = await backend.search(trimmedQuery, {
					...options,
					maxResults: options.maxResults ?? config.maxResults ?? 5,
				})

				this.queryCache.set(cacheKey, {
					items: results,
					timestamp: Date.now(),
				})

				return results
			} catch (error: any) {
				lastError = error
				if (error.message?.includes("429") && attempts < 2) {
					// Wait 1500ms before retrying once
					await new Promise((resolve) => setTimeout(resolve, 1500))
					continue
				}
				break
			}
		}

		throw lastError
	}

	/**
	 * Fetches readable content from a URL with SSRF protection.
	 */
	public async fetchUrl(url: string, options: FetchUrlOptions = {}): Promise<FetchUrlResult> {
		return this.urlFetcher.fetch(url, options)
	}

	/**
	 * Clears the query cache.
	 */
	public clearCache(): void {
		this.queryCache.clear()
	}
}
