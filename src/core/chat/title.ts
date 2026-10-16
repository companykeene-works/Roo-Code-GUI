/**
 * Generates and sanitizes a concise title for a chat session from the initial prompt.
 */
export function generateChatTitle(prompt: string, maxLength = 60): string {
	if (!prompt || typeof prompt !== "string") {
		return "New Chat"
	}

	const lines = prompt.split(/\r?\n/)
	let candidate = ""
	let inCodeFence = false
	let fallbackCodeLine = ""

	for (const line of lines) {
		const trimmed = line.trim()
		if (!trimmed) continue

		if (trimmed.startsWith("```")) {
			inCodeFence = !inCodeFence
			continue
		}

		if (inCodeFence) {
			if (!fallbackCodeLine) {
				fallbackCodeLine = trimmed
			}
			continue
		}

		let cleaned = trimmed
		// Strip markdown headers: #, ##, ###, etc.
		cleaned = cleaned.replace(/^#+\s*/, "")
		// Strip blockquotes: >
		cleaned = cleaned.replace(/^>\s*/, "")
		// Strip list markers and checkboxes: *, -, +, 1., [ ], [x]
		cleaned = cleaned.replace(/^([-*+]|\d+\.)\s*(\[[ xX]\]\s*)?/, "")
		// Strip bold, italic, strikethrough: **text**, *text*, __text__, _text_, ~~text~~
		cleaned = cleaned.replace(/(\*\*|__|\*|_|~~)(.*?)\1/g, "$2")
		// Strip inline code backticks: `code`
		cleaned = cleaned.replace(/`([^`]+)`/g, "$1")
		// Strip markdown links: [text](url) -> text
		cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
		// Strip markdown images: ![alt](url) -> alt
		cleaned = cleaned.replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
		// Strip HTML/XML tags: <tag> -> ""
		cleaned = cleaned.replace(/<[^>]+>/g, "")
		// Collapse whitespace
		cleaned = cleaned.replace(/\s+/g, " ").trim()

		if (cleaned) {
			candidate = cleaned
			break
		}
	}

	if (!candidate && fallbackCodeLine) {
		candidate = fallbackCodeLine
	}

	if (!candidate) return "New Chat"

	const chars = Array.from(candidate)
	if (chars.length > maxLength) {
		return chars.slice(0, maxLength - 3).join("").trimEnd() + "..."
	}
	return candidate
}
