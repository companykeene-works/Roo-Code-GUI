import * as cheerio from "cheerio"
import TurndownService from "turndown"
import { validateUrlSafety } from "./ssrf.js"
import { FetchUrlOptions, FetchUrlResult } from "./types.js"

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024 // 2MB hard limit to prevent memory exhaustion
const MAX_REDIRECTS = 5
const DEFAULT_TIMEOUT_MS = 15000
const DEFAULT_MAX_CHARS = 50000
const ABSOLUTE_MAX_CHARS = 150000

export class UrlFetcher {
	private turndown: TurndownService

	constructor() {
		this.turndown = new TurndownService({
			headingStyle: "atx",
			hr: "---",
			bulletListMarker: "-",
			codeBlockStyle: "fenced",
		})
		// Avoid embedding data URLs or giant images
		this.turndown.addRule("removeImages", {
			filter: "img",
			replacement: (_content, node) => {
				const alt = (node as HTMLElement).getAttribute("alt") || ""
				return alt ? `[Image: ${alt}]` : ""
			},
		})
	}

	/**
	 * Fetches and parses content from a URL with SSRF protection, size caps, and readable markdown extraction.
	 */
	public async fetch(url: string, options: FetchUrlOptions = {}): Promise<FetchUrlResult> {
		const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
		const maxChars = Math.min(options.maxChars ?? DEFAULT_MAX_CHARS, ABSOLUTE_MAX_CHARS)

		let currentUrl = url
		let redirectCount = 0
		let finalResponse: Response | null = null

		// Redirect loop with SSRF validation on every step
		while (true) {
			// Validate safety of current URL (protocol, host, and resolved IP addresses)
			await validateUrlSafety(currentUrl)

			let response: Response
			try {
				response = await fetch(currentUrl, {
					method: "GET",
					headers: {
						"User-Agent":
							"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
						Accept:
							"text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.9,text/plain;q=0.8,*/*;q=0.5",
						"Accept-Language": "en-US,en;q=0.9",
					},
					redirect: "manual",
					signal: AbortSignal.timeout(timeoutMs),
				})
			} catch (error: any) {
				if (error.name === "TimeoutError" || error.message?.includes("timeout")) {
					throw new Error(`Request timed out after ${timeoutMs}ms while fetching ${currentUrl}`)
				}
				throw new Error(`Network error while fetching ${currentUrl}: ${error.message || String(error)}`)
			}

			// Handle HTTP redirects manually
			if ([301, 302, 303, 307, 308].includes(response.status)) {
				redirectCount++
				if (redirectCount > MAX_REDIRECTS) {
					throw new Error(`Too many redirects (exceeded limit of ${MAX_REDIRECTS})`)
				}

				const locationHeader = response.headers.get("location")
				if (!locationHeader) {
					throw new Error(`Redirect status ${response.status} received without Location header`)
				}

				// Resolve relative redirects against current URL
				const nextUrl = new URL(locationHeader, currentUrl).toString()
				currentUrl = nextUrl
				continue
			}

			finalResponse = response
			break
		}

		if (!finalResponse.ok) {
			throw new Error(`HTTP ${finalResponse.status} ${finalResponse.statusText} fetching ${currentUrl}`)
		}

		const contentType = (finalResponse.headers.get("content-type") || "text/plain").toLowerCase()

		// Stream body up to MAX_RESPONSE_BYTES
		let buffer: Buffer
		if (finalResponse.body) {
			const reader = finalResponse.body.getReader()
			let totalBytes = 0
			const chunks: Uint8Array[] = []

			while (true) {
				const { done, value } = await reader.read()
				if (done) break
				if (value) {
					totalBytes += value.length
					chunks.push(value)
					if (totalBytes >= MAX_RESPONSE_BYTES) {
						await reader.cancel()
						break
					}
				}
			}
			buffer = Buffer.concat(chunks)
		} else {
			const arrayBuffer = await finalResponse.arrayBuffer()
			buffer = Buffer.from(arrayBuffer)
		}

		const rawText = buffer.toString("utf-8")
		let title: string | undefined
		let extractedContent = ""

		if (contentType.includes("html")) {
			const $ = cheerio.load(rawText)

			// Extract title
			const rawTitle = $("title").first().text().trim()
			if (rawTitle) {
				title = rawTitle.replace(/\s+/g, " ")
			}

			// Strip unneeded elements
			$(
				"script, style, noscript, iframe, svg, canvas, nav, footer, header, aside, form, button, link, meta, select, option, style",
			).remove()

			const bodyHtml = $("body").html() || ""
			let markdown = ""
			try {
				markdown = this.turndown.turndown(bodyHtml)
			} catch {
				markdown = $("body").text()
			}

			// Clean up redundant blank lines
			extractedContent = markdown.replace(/\n{3,}/g, "\n\n").trim()
			if (!extractedContent) {
				extractedContent = $("body").text().replace(/\s+/g, " ").trim()
			}
		} else if (contentType.includes("json")) {
			try {
				const parsed = JSON.parse(rawText)
				extractedContent = JSON.stringify(parsed, null, 2)
			} catch {
				extractedContent = rawText
			}
		} else {
			// Plain text or markdown
			extractedContent = rawText.trim()
		}

		let truncated = false
		if (extractedContent.length > maxChars) {
			extractedContent = extractedContent.slice(0, maxChars) + "\n\n[Content truncated...]"
			truncated = true
		}

		// Wrap with untrusted content banner to prevent prompt injection
		const sanitizedContent = `[UNTRUSTED WEB CONTENT START: ${currentUrl}]\n${extractedContent}\n[UNTRUSTED WEB CONTENT END: ${currentUrl}]`

		return {
			finalUrl: currentUrl,
			title,
			content: sanitizedContent,
			contentType,
			truncated,
		}
	}
}
