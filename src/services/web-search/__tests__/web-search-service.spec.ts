import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { WebSearchService } from "../WebSearchService.js"
import { BraveSearchBackend } from "../backends/BraveSearchBackend.js"
import { TavilySearchBackend } from "../backends/TavilySearchBackend.js"
import { SearxngSearchBackend } from "../backends/SearxngSearchBackend.js"
import { UrlFetcher } from "../UrlFetcher.js"

describe("WebSearchService and Backends", () => {
	const originalFetch = global.fetch

	afterEach(() => {
		global.fetch = originalFetch
		vi.restoreAllMocks()
	})

	describe("BraveSearchBackend", () => {
		it("fails if API key is missing", async () => {
			const backend = new BraveSearchBackend("")
			await expect(backend.search("test query")).rejects.toThrow("Brave Search API key is missing")
		})

		it("normalizes Brave search results", async () => {
			global.fetch = vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({
					web: {
						results: [
							{
								title: "Example Title",
								url: "https://example.com/page",
								description: "Example snippet description",
								age: "2 days ago",
							},
						],
					},
				}),
			} as any)

			const backend = new BraveSearchBackend("test-brave-key")
			const results = await backend.search("query", { maxResults: 5 })

			expect(results).toHaveLength(1)
			expect(results[0]).toEqual({
				title: "Example Title",
				url: "https://example.com/page",
				snippet: "Example snippet description",
				domain: "example.com",
				publishedAt: "2 days ago",
			})
		})

		it("handles 429 rate limit error", async () => {
			global.fetch = vi.fn().mockResolvedValue({
				ok: false,
				status: 429,
				statusText: "Too Many Requests",
			} as any)

			const backend = new BraveSearchBackend("test-brave-key")
			await expect(backend.search("query")).rejects.toThrow("rate limit reached")
		})
	})

	describe("TavilySearchBackend", () => {
		it("fails if API key is missing", async () => {
			const backend = new TavilySearchBackend("")
			await expect(backend.search("query")).rejects.toThrow("Tavily API key is missing")
		})

		it("normalizes Tavily search results", async () => {
			global.fetch = vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({
					results: [
						{
							title: "Tavily Title",
							url: "https://tavily.com/doc",
							content: "Tavily content snippet",
							published_date: "2026-01-01",
						},
					],
				}),
			} as any)

			const backend = new TavilySearchBackend("test-tavily-key")
			const results = await backend.search("tavily query")

			expect(results).toHaveLength(1)
			expect(results[0]).toEqual({
				title: "Tavily Title",
				url: "https://tavily.com/doc",
				snippet: "Tavily content snippet",
				domain: "tavily.com",
				publishedAt: "2026-01-01",
			})
		})
	})

	describe("SearxngSearchBackend", () => {
		it("fails if SearXNG URL is missing", async () => {
			const backend = new SearxngSearchBackend("")
			await expect(backend.search("query")).rejects.toThrow("SearXNG instance URL is missing")
		})

		it("normalizes SearXNG search results", async () => {
			global.fetch = vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({
					results: [
						{
							title: "SearXNG Result",
							url: "https://searx.be/item",
							content: "SearXNG snippet",
						},
					],
				}),
			} as any)

			const backend = new SearxngSearchBackend("https://searx.example.com")
			const results = await backend.search("query")

			expect(results).toHaveLength(1)
			expect(results[0]).toEqual({
				title: "SearXNG Result",
				url: "https://searx.be/item",
				snippet: "SearXNG snippet",
				domain: "searx.be",
				publishedAt: undefined,
			})
		})
	})

	describe("WebSearchService", () => {
		let service: WebSearchService

		beforeEach(() => {
			service = new WebSearchService()
			service.clearCache()
		})

		it("correctly identifies whether service is configured", () => {
			expect(service.isConfigured({ enabled: false, apiKey: "key" })).toBe(false)
			expect(service.isConfigured({ enabled: true, provider: "brave", apiKey: "" })).toBe(false)
			expect(service.isConfigured({ enabled: true, provider: "brave", apiKey: "valid-key" })).toBe(true)
			expect(service.isConfigured({ enabled: true, provider: "searxng", searxngUrl: "" })).toBe(false)
			expect(service.isConfigured({ enabled: true, provider: "searxng", searxngUrl: "https://searx.me" })).toBe(true)
		})

		it("caches search results for identical queries", async () => {
			let fetchCalls = 0
			global.fetch = vi.fn().mockImplementation(async () => {
				fetchCalls++
				return {
					ok: true,
					json: async () => ({
						web: {
							results: [
								{ title: "Result 1", url: "https://test.com", description: "Desc 1" },
							],
						},
					}),
				}
			})

			const config = { enabled: true, provider: "brave" as const, apiKey: "key" }
			const results1 = await service.search("test query", {}, config)
			const results2 = await service.search("test query", {}, config)

			expect(results1).toEqual(results2)
			expect(fetchCalls).toBe(1) // Second call came from cache
		})

		it("throws an error when disabled", async () => {
			await expect(
				service.search("query", {}, { enabled: false, provider: "brave", apiKey: "key" }),
			).rejects.toThrow("Web access is disabled")
		})
	})

	describe("UrlFetcher", () => {
		it("converts HTML to readable markdown and wraps with untrusted markers", async () => {
			const html = `
				<!DOCTYPE html>
				<html>
				<head><title>My Test Page</title></head>
				<body>
					<nav><a href="/home">Home</a></nav>
					<h1>Heading 1</h1>
					<p>This is a paragraph with <strong>bold text</strong>.</p>
					<script>console.log("bad script");</script>
					<footer>Footer copyright</footer>
				</body>
				</html>
			`

			// Mock response for example.com
			global.fetch = vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				statusText: "OK",
				headers: new Headers({ "content-type": "text/html; charset=utf-8" }),
				body: {
					getReader: () => {
						let readOnce = false
						return {
							read: async () => {
								if (!readOnce) {
									readOnce = true
									return { done: false, value: Buffer.from(html) }
								}
								return { done: true, value: undefined }
							},
							cancel: async () => {},
						}
					},
				},
			} as any)

			const fetcher = new UrlFetcher()
			const res = await fetcher.fetch("https://example.com/test")

			expect(res.finalUrl).toBe("https://example.com/test")
			expect(res.title).toBe("My Test Page")
			expect(res.content).toContain("[UNTRUSTED WEB CONTENT START: https://example.com/test]")
			expect(res.content).toContain("# Heading 1")
			expect(res.content).toContain("This is a paragraph with **bold text**.")
			expect(res.content).not.toContain("bad script")
			expect(res.content).not.toContain("Footer copyright")
			expect(res.content).toContain("[UNTRUSTED WEB CONTENT END: https://example.com/test]")
		})

		it("truncates content exceeding maxChars", async () => {
			const longText = "A".repeat(1000)
			global.fetch = vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				statusText: "OK",
				headers: new Headers({ "content-type": "text/plain" }),
				body: {
					getReader: () => {
						let readOnce = false
						return {
							read: async () => {
								if (!readOnce) {
									readOnce = true
									return { done: false, value: Buffer.from(longText) }
								}
								return { done: true, value: undefined }
							},
							cancel: async () => {},
						}
					},
				},
			} as any)

			const fetcher = new UrlFetcher()
			const res = await fetcher.fetch("https://example.com/long", { maxChars: 200 })

			expect(res.truncated).toBe(true)
			expect(res.content).toContain("[Content truncated...]")
		})
	})
})
