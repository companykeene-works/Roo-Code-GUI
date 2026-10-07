import * as path from "path"
import * as fs from "fs"

export interface ParsedFilesystemScope {
	scopedWriteAllows: string[]
	scopedWriteDenies: string[]
	hasExplicitScope: boolean
	explicitScopeDetected: boolean
	sourceDirective?: string
}

export interface ScopeParserOptions {
	workspacePath?: string
	cwd?: string
}

export interface ScopeMatchOptions {
	workspacePath?: string
	cwd?: string
}

/**
 * Natural language words and phrases that must NEVER be parsed as a standalone filesystem path.
 */
const BANNED_NATURAL_LANGUAGE_WORDS = new Set([
	// English articles, pronouns, prepositions, auxiliaries
	"the",
	"a",
	"an",
	"this",
	"that",
	"these",
	"those",
	"it",
	"they",
	"we",
	"you",
	"what",
	"which",
	"who",
	"when",
	"where",
	"why",
	"how",
	"is",
	"are",
	"was",
	"were",
	"be",
	"been",
	"being",
	"have",
	"has",
	"had",
	"do",
	"does",
	"did",
	"can",
	"could",
	"may",
	"might",
	"must",
	"shall",
	"should",
	"will",
	"would",
	"only",
	"all",
	"any",
	"some",
	"every",
	"no",
	"not",
	// Business requirements and abstract descriptors
	"required",
	"needed",
	"intended",
	"necessary",
	"relevant",
	"described",
	"below",
	"above",
	"conceptually",
	"fields",
	"field",
	"value",
	"values",
	"changes",
	"change",
	"release",
	"blocker",
	"blockers",
	"issues",
	"issue",
	"operation",
	"save",
	"button",
	"code",
	"files",
	"file",
	"everything",
	"else",
	"nothing",
	"anything",
	"somewhere",
	// Polish equivalents
	"kodu",
	"kod",
	"plików",
	"pliki",
	"plik",
	"niczego",
	"wszystko",
	"zmiany",
	"zmian",
	"wymagane",
	"wymaganych",
	"pola",
	"pól",
	"wartości",
	"operacja",
	"zapis",
])

/**
 * Normalizes path separators to forward slashes and converts WSL paths to Windows paths when running on win32.
 */
export function normalizePathSeparators(rawPath: string): string {
	if (!rawPath) return ""
	let normalized = rawPath.trim().replace(/\\/g, "/")
	// Convert WSL path /mnt/c/... -> c:/...
	if (process.platform === "win32" && /^\/mnt\/([a-zA-Z])\/(.*)$/.test(normalized)) {
		normalized = normalized.replace(/^\/mnt\/([a-zA-Z])\/(.*)$/, "$1:/$2")
	}
	return normalized
}

/**
 * Strips Polish genitive inflection suffix (e.g. "backendu" -> "backend", "frontendu" -> "frontend").
 */
function stripPolishGenitive(s: string): string {
	if (s.length > 4 && s.endsWith("u") && !s.includes("/") && !s.includes("\\")) {
		return s.slice(0, -1)
	}
	return s
}

/**
 * Normalizes a scope path or target path into a canonical forward-slash relative path within workspace.
 */
export function normalizeScopePath(candidate: string, workspacePath?: string): string {
	if (!candidate) return ""
	let cleaned = candidate.trim()

	// Strip wrapping quotes
	cleaned = cleaned.replace(/^["']|["']$/g, "").trim()

	cleaned = normalizePathSeparators(cleaned)

	// Strip trailing punctuation (comma, colon, semicolon) but NOT dot if it's an extension or navigation
	const hasTrailingSlash = cleaned.endsWith("/")
	cleaned = cleaned.replace(/[,:;!]+$/, "")
	if (cleaned !== "." && cleaned !== ".." && cleaned.endsWith(".")) {
		cleaned = cleaned.slice(0, -1)
	}
	if (hasTrailingSlash && !cleaned.endsWith("/")) {
		cleaned += "/"
	}

	cleaned = stripPolishGenitive(cleaned)

	// If workspacePath is provided, resolve relative vs absolute
	if (workspacePath) {
		const normWs = normalizePathSeparators(path.resolve(workspacePath))
		const isWin = process.platform === "win32"
		const compareWs = isWin ? normWs.toLowerCase() : normWs
		const wsBase = path.posix.basename(normWs)
		const compareWsBase = isWin ? wsBase.toLowerCase() : wsBase
		const compareClean = isWin ? cleaned.toLowerCase() : cleaned

		if (compareClean === compareWsBase || compareWs.endsWith("/" + compareClean)) {
			return "."
		}

		let absCandidate: string
		if (path.isAbsolute(cleaned) || (isWin && /^[a-zA-Z]:\//.test(cleaned))) {
			absCandidate = normalizePathSeparators(path.resolve(cleaned))
		} else {
			absCandidate = normalizePathSeparators(path.resolve(normWs, cleaned))
		}

		const compareAbs = isWin ? absCandidate.toLowerCase() : absCandidate

		if (compareAbs === compareWs) {
			return "."
		}

		if (compareAbs.startsWith(compareWs + "/")) {
			let rel = compareAbs.slice(compareWs.length + 1)
			return rel.replace(/\/+$/, "")
		}
	}

	// For relative paths: use path.posix.normalize to resolve "." and ".."
	let posixNorm = path.posix.normalize(cleaned).replace(/^\.\//, "").replace(/\/+$/, "")
	if (process.platform === "win32") {
		posixNorm = posixNorm.toLowerCase()
	}
	return posixNorm
}

/**
 * Checks whether a candidate string is syntactically a valid filesystem path (file or directory).
 * Does NOT require that the path already exists on disk.
 */
export function isValidPathCandidate(rawCandidate: string, workspacePath?: string): boolean {
	if (!rawCandidate) return false
	let candidate = rawCandidate.trim()

	// Strip wrapping quotes
	candidate = candidate.replace(/^["']|["']$/g, "").trim()

	// Reject pure punctuation
	if (!candidate || /^[:.,;!\-/*\\#?%]+$/.test(candidate)) {
		return false
	}

	// Strip trailing punctuation
	let cleanToken = candidate.replace(/[.,:;!]+$/, "").trim().toLowerCase()
	cleanToken = stripPolishGenitive(cleanToken)

	// Check against banned single words
	if (BANNED_NATURAL_LANGUAGE_WORDS.has(cleanToken)) {
		return false
	}

	// Reject if contains spaces and does NOT look like a path
	if (/\s+/.test(cleanToken)) {
		// Phrases like "the intended fields", "the fields required by this form", "what is required"
		const words = cleanToken.split(/\s+/)
		const hasBannedWord = words.some((w) => BANNED_NATURAL_LANGUAGE_WORDS.has(w))
		if (hasBannedWord) {
			return false
		}
		// Without path separator or extension, spaces indicate natural language
		if (!cleanToken.includes("/") && !cleanToken.includes("\\") && !/\.[a-z0-9]{1,10}$/i.test(cleanToken)) {
			return false
		}
	}

	// Positive indicators of a filesystem path:
	// 1. Contains path separator / or \
	if (cleanToken.includes("/") || cleanToken.includes("\\")) {
		// Ensure it's not just / or ./ alone
		const stripped = cleanToken.replace(/^[./\\]+|[./\\]+$/g, "")
		if (stripped.length > 0 && !BANNED_NATURAL_LANGUAGE_WORDS.has(stripped)) {
			return true
		}
	}

	// 2. Has a file extension with 1 to 10 alphanumeric characters (e.g. foo.ts, bar.js, config.json, .env)
	if (/^[a-z0-9_\-]*\.[a-z0-9]{1,10}$/i.test(cleanToken) && cleanToken !== ".") {
		return true
	}

	// 3. Starts with path navigation prefix (./, ../, ~/, /) or Windows drive (c:/)
	if (/^(\.\/|\.\.\/|~\/|\/|[a-z]:[/\\])/i.test(candidate)) {
		return true
	}

	// 4. If workspacePath is provided, check if a directory or file with this exact name exists in workspace root
	if (workspacePath) {
		try {
			const candidatePath = path.join(workspacePath, cleanToken)
			if (fs.existsSync(candidatePath)) {
				return true
			}
		} catch {}
	}

	// 5. Common top-level directory names in projects
	const COMMON_PROJECT_DIRS = new Set([
		"src",
		"lib",
		"packages",
		"apps",
		"backend",
		"frontend",
		"shared",
		"core",
		"components",
		"utils",
		"test",
		"tests",
		"docs",
		"config",
		"scripts",
		"security",
		"licensing",
		"velune-website",
	])
	if (COMMON_PROJECT_DIRS.has(cleanToken)) {
		return true
	}

	return false
}

/**
 * Extracts candidate tokens from a directive section text.
 */
function extractCandidateTokens(sectionText: string): string[] {
	if (!sectionText) return []

	// Strip leading colons and whitespace
	let text = sectionText.replace(/^[:\s]+/, "")

	// Split by newlines, semicolons, commas, or conjunctions ("and", "or", "i", "oraz", "ani")
	// CRITICAL: NEVER split by "/" or "\" as they are path separators!
	const items = text.split(/\n|;|,|\s+and\s+|\s+or\s+|\s+oraz\s+|\s+i\s+|\s+ani\s+/)
	const candidates: string[] = []

	for (const item of items) {
		let token = item.trim()
		// Strip leading bullet markers (*, -, •, >) and colons
		token = token.replace(/^[\s*\-•:>]+/, "").trim()
		// Strip comments or parenthetical notes (e.g. "src/foo.ts (only for auth)")
		token = token.replace(/[\(\)].*$/, "").trim()
		// Strip trailing sentence punctuation if any
		token = token.replace(/[;!]+$/, "").trim()

		if (token) {
			// If token contains slash as a list separator without file extension or trailing slash
			// e.g. "security/licensing/backend"
			if (token.includes("/") && !token.endsWith("/") && !/\.[a-z0-9]+$/i.test(token)) {
				const slashParts = token.split("/")
				if (slashParts.length > 1 && slashParts.every((p) => /^[a-z0-9_-]+$/i.test(p.trim()))) {
					candidates.push(...slashParts.map((p) => p.trim()))
				}
			}
			candidates.push(token)
		}
	}

	return candidates
}

/**
 * Strict Directive Parser:
 * Detects whether the input text contains explicit filesystem scope directives
 * and extracts valid, normalized filesystem paths for allowances and denials.
 */
export function parseExplicitFilesystemScope(
	text: string,
	options?: ScopeParserOptions,
): ParsedFilesystemScope {
	const scopedWriteAllows: string[] = []
	const scopedWriteDenies: string[] = []
	let explicitScopeDetected = false
	let sourceDirective: string | undefined

	if (!text || !text.trim()) {
		return {
			scopedWriteAllows,
			scopedWriteDenies,
			hasExplicitScope: false,
			explicitScopeDetected: false,
		}
	}

	const workspacePath = options?.workspacePath
	const lines = text.split(/\r?\n/)

	// Section-based directive extraction:
	// Find lines that represent explicit section headers for scope restrictions
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].trim()
		if (!line) continue

		// 1. Positive allowance section header:
		// e.g. "You MAY modify ONLY:" or "Modify only:" or "Commit only:" or "Zakres zapisu wyłącznie w:"
		const isAllowHeader =
			/^(?:[-*•#>\d.]+\s*)?(?:you\s+(?:may|can)\s+)?(?:only\s+)?(?:modify|edit|commit)\s+(?:only|wyłącznie|tylko)\s*[:]?$/i.test(line) ||
			/^(?:[-*•#>\d.]+\s*)?(?:możesz\s+(?:modyfikować|commitować)\s+wyłącznie|modyfikuj\s+wyłącznie|commituj\s+wyłącznie|zakres\s+zapisu(?:\s*:\s*|\s+)wyłącznie(?:\s*w)?)\s*[:]?$/i.test(line) ||
			/^(?:write\s+(?:authorization|access|scope):\s*(?:you\s+may\s+modify\s+only)?)\s*:?$/i.test(line) ||
			/^(?:authorized|allowed)\s+to\s+(?:modify|commit)\s+only\s*:?$/i.test(line)

		if (isAllowHeader) {
			sourceDirective = line
			// Collect following lines until another directive header or double blank line
			let j = i + 1
			let consecutiveEmpty = 0
			const sectionLines: string[] = []
			while (j < lines.length) {
				const nextLine = lines[j].trim()
				if (!nextLine) {
					consecutiveEmpty++
					if (consecutiveEmpty >= 2) break
					j++
					continue
				}
				consecutiveEmpty = 0
				// Check if nextLine starts a new directive
				if (/^(?:do\s+not|nie\s+|goals?|instructions?|uwaga|zakaz)\b/i.test(nextLine)) {
					break
				}
				sectionLines.push(nextLine)
				j++
			}

			const tokens = extractCandidateTokens(sectionLines.join("\n"))
			for (const tok of tokens) {
				if (isValidPathCandidate(tok, workspacePath)) {
					const normalized = normalizeScopePath(tok, workspacePath)
					if (normalized && !scopedWriteAllows.includes(normalized)) {
						scopedWriteAllows.push(normalized)
						explicitScopeDetected = true
					}
				}
			}
			continue
		}

		// 2. Negative denial section header:
		// e.g. "Do NOT modify files in:" or "Nie modyfikuj plików w:" or "Zakaz modyfikacji:"
		const isDenyHeader =
			/^(?:[-*•#>\d.]+\s*)?(?:do\s+not|don't)\s+(?:modify|edit|touch|change|commit)(?:\s+(?:files\s+in|code\s+in))?\s*[:]?$/i.test(line) ||
			/^(?:[-*•#>\d.]+\s*)?(?:nie\s+(?:modyfikuj|edytuj|ruszaj|zmieniaj|commituj)(?:\s+(?:plików\s+w|kodu\s+w))?|zakaz\s+(?:modyfikacji|commitów))\s*[:]?$/i.test(line)

		if (isDenyHeader) {
			let j = i + 1
			let consecutiveEmpty = 0
			const sectionLines: string[] = []
			while (j < lines.length) {
				const nextLine = lines[j].trim()
				if (!nextLine) {
					consecutiveEmpty++
					if (consecutiveEmpty >= 2) break
					j++
					continue
				}
				consecutiveEmpty = 0
				if (/^(?:modify\s+only|commit\s+only|goals?|instructions?|uwaga)\b/i.test(nextLine)) {
					break
				}
				sectionLines.push(nextLine)
				j++
			}

			const tokens = extractCandidateTokens(sectionLines.join("\n"))
			for (const tok of tokens) {
				if (isValidPathCandidate(tok, workspacePath)) {
					const normalized = normalizeScopePath(tok, workspacePath)
					if (normalized && !scopedWriteDenies.includes(normalized)) {
						scopedWriteDenies.push(normalized)
						explicitScopeDetected = true
					}
				}
			}
			continue
		}

		// 3. Inline sentence directives (handling multiple sentences per line):
		const sentences = line.split(/(?<=[.?!;])\s+/)
		for (const sentence of sentences) {
			const inlineAllowMatch = sentence.match(
				/(?:^|[-*•#>\d.]+\s*|\bplease\s+|\b)(?:modify|edit|commit)\s+only(?:\s*:)?\s+(.+)$/i,
			)
			if (inlineAllowMatch && inlineAllowMatch[1]) {
				const targetChunk = inlineAllowMatch[1].split(/\.(?:\s+|$)/)[0]
				const tokens = extractCandidateTokens(targetChunk)
				for (const tok of tokens) {
					if (isValidPathCandidate(tok, workspacePath)) {
						const normalized = normalizeScopePath(tok, workspacePath)
						if (normalized && !scopedWriteAllows.includes(normalized)) {
							scopedWriteAllows.push(normalized)
							explicitScopeDetected = true
							sourceDirective = sentence
						}
					}
				}
			}

			const inlineDenyMatch = sentence.match(
				/(?:^|[-*•#>\d.]+\s*|\b)(?:do\s+not\s+(?:modify|touch|edit|commit|change)|don't\s+(?:modify|touch|edit|commit|change)|nie\s+(?:modyfikuj|ruszaj|edytuj|commituj|zmieniaj))\s+(?:files\s+in\s+|plików\s+w\s+|changes\s+to\s+|zmian\s+w\s+|już\s+)?(.+)$/i,
			)
			if (inlineDenyMatch && inlineDenyMatch[1]) {
				const targetChunk = inlineDenyMatch[1].split(/\.(?:\s+|$)/)[0]
				const tokens = extractCandidateTokens(targetChunk)
				for (const tok of tokens) {
					if (isValidPathCandidate(tok, workspacePath)) {
						const normalized = normalizeScopePath(tok, workspacePath)
						if (normalized && !scopedWriteDenies.includes(normalized)) {
							scopedWriteDenies.push(normalized)
							explicitScopeDetected = true
						}
					}
				}
			}

			const postfixDenyMatch = sentence.match(
				/(?:^|[-*•#>\d.]+\s*|\b)([a-z0-9_./\\-]+)\s+(?:już\s+)?(?:nie\s+(?:modyfikuj|ruszaj|edytuj|zmieniaj|commituj)|(?:do\s+not|don't)\s+(?:modify|touch|edit|change|commit))/i,
			)
			if (postfixDenyMatch && postfixDenyMatch[1]) {
				const tok = postfixDenyMatch[1].trim()
				if (isValidPathCandidate(tok, workspacePath)) {
					const normalized = normalizeScopePath(tok, workspacePath)
					if (normalized && !scopedWriteDenies.includes(normalized)) {
						scopedWriteDenies.push(normalized)
						explicitScopeDetected = true
					}
				}
			}
		}
	}

	return {
		scopedWriteAllows,
		scopedWriteDenies,
		hasExplicitScope: scopedWriteAllows.length > 0 || scopedWriteDenies.length > 0,
		explicitScopeDetected,
		sourceDirective,
	}
}

/**
 * Checks whether a given target file path falls within any of the provided scopes.
 * Supports exact file matching, directory hierarchy matching, and canonical Windows/WSL resolution.
 */
export function isPathInScope(
	filePath: string,
	scopes: string[],
	options?: ScopeMatchOptions,
): boolean {
	if (!filePath || !scopes || scopes.length === 0) {
		return false
	}

	const workspacePath = options?.workspacePath
	const normTarget = normalizeScopePath(filePath, workspacePath)
	if (!normTarget) return false

	for (const scope of scopes) {
		if (!scope) continue
		const normScope = normalizeScopePath(scope, workspacePath)
		if (!normScope) continue

		// Entire workspace match: matches all targets within the workspace
		if (normScope === "." || normScope === "/") {
			const isOutside =
				normTarget !== "." &&
				(/^[a-zA-Z]:\/|^\/|^\.\.\//.test(normTarget) || path.posix.isAbsolute(normTarget))
			if (!isOutside) {
				return true
			}
			continue
		}

		// Exact file match
		if (normTarget === normScope) {
			return true
		}

		// Directory hierarchy match (normTarget starts with normScope + "/")
		if (normTarget.startsWith(`${normScope}/`)) {
			return true
		}

		// Also check if scope without workspacePath is matched by target
		if (normScope !== "." && normScope !== "/") {
			if (normTarget.endsWith(`/${normScope}`) || normTarget.includes(`/${normScope}/`)) {
				return true
			}
		}
	}

	return false
}
