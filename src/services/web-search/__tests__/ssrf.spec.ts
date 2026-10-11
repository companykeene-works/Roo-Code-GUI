import { describe, it, expect } from "vitest"
import { isPrivateIpv4, isPrivateIpv6, isPrivateOrBlockedIp, validateUrlSafety } from "../ssrf.js"

describe("SSRF Protection", () => {
	describe("isPrivateIpv4", () => {
		it("detects loopback addresses", () => {
			expect(isPrivateIpv4("127.0.0.1")).toBe(true)
			expect(isPrivateIpv4("127.0.0.2")).toBe(true)
			expect(isPrivateIpv4("127.255.255.255")).toBe(true)
		})

		it("detects RFC 1918 private subnets", () => {
			expect(isPrivateIpv4("10.0.0.1")).toBe(true)
			expect(isPrivateIpv4("10.255.255.255")).toBe(true)
			expect(isPrivateIpv4("172.16.0.1")).toBe(true)
			expect(isPrivateIpv4("172.31.255.255")).toBe(true)
			expect(isPrivateIpv4("192.168.0.1")).toBe(true)
			expect(isPrivateIpv4("192.168.254.254")).toBe(true)
		})

		it("allows public addresses around RFC 1918 boundaries", () => {
			expect(isPrivateIpv4("172.15.255.255")).toBe(false)
			expect(isPrivateIpv4("172.32.0.1")).toBe(false)
			expect(isPrivateIpv4("192.167.1.1")).toBe(false)
			expect(isPrivateIpv4("192.169.1.1")).toBe(false)
		})

		it("detects cloud metadata and link-local (169.254.0.0/16)", () => {
			expect(isPrivateIpv4("169.254.169.254")).toBe(true)
			expect(isPrivateIpv4("169.254.1.1")).toBe(true)
		})

		it("detects multicast and reserved ranges", () => {
			expect(isPrivateIpv4("224.0.0.1")).toBe(true)
			expect(isPrivateIpv4("239.255.255.255")).toBe(true)
			expect(isPrivateIpv4("240.0.0.1")).toBe(true)
			expect(isPrivateIpv4("0.0.0.0")).toBe(true)
		})

		it("allows standard public internet IPs", () => {
			expect(isPrivateIpv4("8.8.8.8")).toBe(false)
			expect(isPrivateIpv4("1.1.1.1")).toBe(false)
			expect(isPrivateIpv4("142.250.190.46")).toBe(false)
		})
	})

	describe("isPrivateIpv6", () => {
		it("detects loopback and unspecified addresses", () => {
			expect(isPrivateIpv6("::1")).toBe(true)
			expect(isPrivateIpv6("::")).toBe(true)
		})

		it("detects link-local addresses", () => {
			expect(isPrivateIpv6("fe80::1")).toBe(true)
			expect(isPrivateIpv6("febf::ffff")).toBe(true)
		})

		it("detects unique local addresses (fc00::/7)", () => {
			expect(isPrivateIpv6("fc00::1")).toBe(true)
			expect(isPrivateIpv6("fd00::1234")).toBe(true)
		})

		it("detects IPv4-mapped IPv6 addresses with private IPs", () => {
			expect(isPrivateIpv6("::ffff:127.0.0.1")).toBe(true)
			expect(isPrivateIpv6("::ffff:10.0.0.1")).toBe(true)
			expect(isPrivateIpv6("::ffff:169.254.169.254")).toBe(true)
			expect(isPrivateIpv6("::ffff:8.8.8.8")).toBe(false)
		})

		it("allows public IPv6 addresses", () => {
			expect(isPrivateIpv6("2606:4700:4700::1111")).toBe(false)
			expect(isPrivateIpv6("2001:4860:4860::8888")).toBe(false)
		})
	})

	describe("validateUrlSafety", () => {
		it("blocks non-HTTP protocols", async () => {
			await expect(validateUrlSafety("file:///etc/passwd")).rejects.toThrow("Only HTTP and HTTPS")
			await expect(validateUrlSafety("ftp://example.com/file")).rejects.toThrow("Only HTTP and HTTPS")
			await expect(validateUrlSafety("gopher://127.0.0.1")).rejects.toThrow("Only HTTP and HTTPS")
		})

		it("blocks sensitive hostnames directly", async () => {
			await expect(validateUrlSafety("http://localhost:8080")).rejects.toThrow("blocked for security")
			await expect(validateUrlSafety("http://sub.localhost:3000")).rejects.toThrow("blocked for security")
			await expect(validateUrlSafety("http://metadata.google.internal")).rejects.toThrow("blocked for security")
		})

		it("blocks direct private IP literals", async () => {
			await expect(validateUrlSafety("http://127.0.0.1:8080")).rejects.toThrow("Access to private IP")
			await expect(validateUrlSafety("http://169.254.169.254/latest")).rejects.toThrow("Access to private IP")
			await expect(validateUrlSafety("http://10.0.0.1")).rejects.toThrow("Access to private IP")
		})

		it("allows valid public URLs", async () => {
			const url = await validateUrlSafety("https://example.com")
			expect(url.hostname).toBe("example.com")
		})
	})
})
