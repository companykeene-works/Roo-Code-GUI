export interface SearchResultItem {
	title: string
	url: string
	snippet: string
	domain: string
	publishedAt?: string
}

export interface SearchOptions {
	maxResults?: number
	allowedDomains?: string[]
	excludedDomains?: string[]
	signal?: AbortSignal
}

export interface SearchBackend {
	readonly name: string
	search(query: string, options?: SearchOptions): Promise<SearchResultItem[]>
}

export interface FetchUrlOptions {
	maxChars?: number
	timeoutMs?: number
}

export interface FetchUrlResult {
	finalUrl: string
	title?: string
	content: string
	contentType: string
	truncated?: boolean
}

export type WebSearchProviderType = "brave" | "tavily" | "searxng"

export interface WebSearchServiceConfig {
	enabled?: boolean
	provider?: WebSearchProviderType
	apiKey?: string
	searxngUrl?: string
	maxResults?: number
}
