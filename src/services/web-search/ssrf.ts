import dns from "dns"
import net from "net"

/**
 * Checks if an IPv4 address string falls into private, loopback, link-local, or reserved ranges.
 */
export function isPrivateIpv4(ip: string): boolean {
	const parts = ip.split(".").map((part) => parseInt(part, 10))
	if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
		// Not a valid standard 4-part IPv4 address; treat as unsafe
		return true
	}

	const [a, b, c] = parts

	// 0.0.0.0/8 (Current network)
	if (a === 0) return true
	// 10.0.0.0/8 (Private network)
	if (a === 10) return true
	// 127.0.0.0/8 (Loopback)
	if (a === 127) return true
	// 169.254.0.0/16 (Link-local / Cloud metadata 169.254.169.254)
	if (a === 169 && b === 254) return true
	// 172.16.0.0/12 (Private network: 172.16.0.0 - 172.31.255.255)
	if (a === 172 && b >= 16 && b <= 31) return true
	// 192.168.0.0/16 (Private network)
	if (a === 192 && b === 168) return true
	// 192.0.0.0/24 (IETF Protocol Assignments)
	if (a === 192 && b === 0 && c === 0) return true
	// 192.0.2.0/24 (TEST-NET-1)
	if (a === 192 && b === 0 && c === 2) return true
	// 198.18.0.0/15 (Network benchmark tests)
	if (a === 198 && (b === 18 || b === 19)) return true
	// 198.51.100.0/24 (TEST-NET-2)
	if (a === 198 && b === 51 && c === 100) return true
	// 203.0.113.0/24 (TEST-NET-3)
	if (a === 203 && b === 0 && c === 113) return true
	// 224.0.0.0/4 (Multicast: 224.0.0.0 - 239.255.255.255)
	if (a >= 224 && a <= 239) return true
	// 240.0.0.0/4 (Reserved / Future use: 240.0.0.0 - 255.255.255.255)
	if (a >= 240) return true

	return false
}

/**
 * Checks if an IPv6 address falls into private, loopback, link-local, or reserved ranges.
 */
export function isPrivateIpv6(ip: string): boolean {
	const normalized = ip.toLowerCase().trim()

	// Loopback and unspecified
	if (normalized === "::1" || normalized === "::" || normalized === "0:0:0:0:0:0:0:1" || normalized === "0:0:0:0:0:0:0:0") {
		return true
	}

	// IPv4-mapped IPv6: e.g. ::ffff:127.0.0.1 or ::ffff:7f00:1
	if (normalized.startsWith("::ffff:") || normalized.startsWith("0:0:0:0:0:ffff:")) {
		const remainder = normalized.replace(/^(?:0:0:0:0:0:ffff:|::ffff:)/, "")
		if (remainder.includes(".")) {
			return isPrivateIpv4(remainder)
		}
		// If hex-encoded IPv4 e.g. 7f00:0001
		const hexParts = remainder.split(":")
		if (hexParts.length === 2) {
			const hex1 = parseInt(hexParts[0], 16)
			const hex2 = parseInt(hexParts[1], 16)
			if (!isNaN(hex1) && !isNaN(hex2)) {
				const octet1 = (hex1 >> 8) & 0xff
				const octet2 = hex1 & 0xff
				const octet3 = (hex2 >> 8) & 0xff
				const octet4 = hex2 & 0xff
				return isPrivateIpv4(`${octet1}.${octet2}.${octet3}.${octet4}`)
			}
		}
		return true
	}

	// Link-local: fe80::/10 (fe80 - febf)
	if (/^fe[89ab][0-9a-f]:/i.test(normalized)) {
		return true
	}

	// Unique local addresses (ULA): fc00::/7 (fc00 - fdff)
	if (/^f[cd][0-9a-f]{2}:/i.test(normalized)) {
		return true
	}

	// Multicast: ff00::/8
	if (normalized.startsWith("ff")) {
		return true
	}

	// Documentation: 2001:db8::/32
	if (normalized.startsWith("2001:db8:") || normalized.startsWith("2001:0db8:")) {
		return true
	}

	// Discard prefix: 100::/64
	if (normalized.startsWith("100::")) {
		return true
	}

	return false
}

/**
 * Checks whether an IP string is either private IPv4 or private IPv6.
 */
export function isPrivateOrBlockedIp(ip: string): boolean {
	if (ip.includes(":")) {
		return isPrivateIpv6(ip)
	}
	return isPrivateIpv4(ip)
}

/**
 * Known sensitive hostnames that should be blocked immediately without DNS lookup.
 */
const BLOCKED_HOSTNAMES = new Set([
	"localhost",
	"ip6-localhost",
	"ip6-loopback",
	"metadata.google.internal",
	"metadata.goog",
	"instance-data",
])

/**
 * Validates a target URL against SSRF vulnerabilities:
 * 1. Must be http: or https:
 * 2. Hostname must not be localhost / internal domains
 * 3. Resolves DNS and verifies all resolved IP addresses are public
 */
export async function validateUrlSafety(rawUrl: string): Promise<URL> {
	let parsedUrl: URL
	try {
		parsedUrl = new URL(rawUrl)
	} catch {
		throw new Error(`Invalid URL format: "${rawUrl}"`)
	}

	// 1. Protocol check
	if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
		throw new Error(
			`Blocked protocol "${parsedUrl.protocol}". Only HTTP and HTTPS protocols are permitted.`,
		)
	}

	const hostname = parsedUrl.hostname.toLowerCase().trim()

	// 2. Direct blocked hostname checks
	if (
		BLOCKED_HOSTNAMES.has(hostname) ||
		hostname.endsWith(".localhost") ||
		hostname.endsWith(".local") ||
		hostname.endsWith(".internal") ||
		hostname.endsWith(".localdomain")
	) {
		throw new Error(`Access to local or internal domain "${hostname}" is blocked for security (SSRF prevention).`)
	}

	// 3. If hostname is directly an IP literal
	// IPv6 literals in URLs are wrapped in brackets, e.g. [::1]
	const ipLiteral = hostname.startsWith("[") && hostname.endsWith("]")
		? hostname.slice(1, -1)
		: hostname

	if (net.isIP(ipLiteral)) {
		if (isPrivateOrBlockedIp(ipLiteral)) {
			throw new Error(`Access to private IP address "${ipLiteral}" is blocked for security (SSRF prevention).`)
		}
		// If it is an explicitly allowed public IP literal, no need to resolve hostname
		return parsedUrl
	}

	// 4. DNS resolution to check resolved IP addresses (prevents DNS rebinding and resolving internal IPs)
	try {
		const addresses = await dns.promises.lookup(hostname, { all: true })
		if (!addresses || addresses.length === 0) {
			throw new Error(`Failed to resolve hostname "${hostname}".`)
		}

		for (const record of addresses) {
			if (isPrivateOrBlockedIp(record.address)) {
				throw new Error(
					`Resolved address "${record.address}" for host "${hostname}" is a private or blocked IP address (SSRF prevention).`,
				)
			}
		}
	} catch (error: any) {
		if (error.message && error.message.includes("SSRF prevention")) {
			throw error
		}
		// If DNS resolution fails, reject fetch
		throw new Error(`Could not resolve hostname "${hostname}": ${error.message || String(error)}`)
	}

	return parsedUrl
}
