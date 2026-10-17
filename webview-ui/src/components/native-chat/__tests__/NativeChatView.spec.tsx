import React from "react"
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@/utils/test-utils"
import { NativeChatView } from "../NativeChatView"

vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

vi.mock("react-virtuoso", () => ({
	Virtuoso: ({ data, itemContent }: any) => (
		<div data-testid="mock-virtuoso">
			{data?.map((item: any, index: number) => (
				<div key={item.id || index}>{itemContent(index, item)}</div>
			))}
		</div>
	),
}))

describe("NativeChatView UI header and mode controls", () => {
	it("renders New Chat button and AI Chat header, and confirms Agent Mode button is REMOVED", () => {
		const mockSwitchToAgent = vi.fn()
		render(<NativeChatView onSwitchToAgent={mockSwitchToAgent} />)

		// Confirm AI Chat header and New Chat button are present
		expect(screen.getByText("AI Chat")).toBeInTheDocument()
		expect(screen.getByTitle("Start a new chat conversation")).toBeInTheDocument()
		expect(screen.getAllByText("New Chat").length).toBeGreaterThanOrEqual(1)

		// Confirm Agent Mode button is NOT present in the DOM
		expect(screen.queryByText("Agent Mode")).toBeNull()
		expect(screen.queryByTitle("Switch back to Agent Mode")).toBeNull()
	})
})
