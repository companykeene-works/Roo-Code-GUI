// npm run test ContextWindowProgress.spec.tsx

import { render, screen } from "@/utils/test-utils"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import { ContextWindowProgress } from "@src/components/chat/ContextWindowProgress"

// Mock formatLargeNumber function
vi.mock("@/utils/format", () => ({
	formatLargeNumber: vi.fn((num) => num.toString()),
}))

describe("ContextWindowProgress", () => {
	const queryClient = new QueryClient()

	const renderComponent = (props: Record<string, any>) => {
		return render(
			<QueryClientProvider client={queryClient}>
				<ContextWindowProgress
					contextWindow={props.contextWindow ?? 4000}
					contextTokens={props.contextTokens ?? 1000}
					maxTokens={props.maxTokens}
				/>
			</QueryClientProvider>,
		)
	}

	beforeEach(() => vi.clearAllMocks())

	it("renders correctly with valid inputs", () => {
		renderComponent({ contextTokens: 1000, contextWindow: 4000 })

		expect(screen.getByTestId("context-tokens-count")).toBeInTheDocument()
		expect(screen.getByTestId("context-tokens-count")).toHaveTextContent("1000")
		expect(screen.getByTestId("context-window-size")).toHaveTextContent("4000")
	})

	it("handles zero context window gracefully", () => {
		renderComponent({ contextTokens: 0, contextWindow: 0 })

		expect(screen.getByTestId("context-tokens-count")).toBeInTheDocument()
		expect(screen.getByTestId("context-tokens-count")).toHaveTextContent("0")
	})

	it("handles edge cases with negative values", () => {
		renderComponent({ contextTokens: -100, contextWindow: 4000 })

		// Should show 0 instead of -100
		expect(screen.getByTestId("context-tokens-count")).toHaveTextContent("0")
		expect(screen.getByTestId("context-window-size")).toHaveTextContent("4000")
	})

	it("calculates percentages correctly", () => {
		renderComponent({ contextTokens: 1000, contextWindow: 4000, maxTokens: 1000 })

		// Verify that the token count and window size are displayed correctly
		const tokenCount = screen.getByTestId("context-tokens-count")
		const windowSize = screen.getByTestId("context-window-size")

		expect(tokenCount).toBeInTheDocument()
		expect(tokenCount).toHaveTextContent("1000")

		expect(windowSize).toBeInTheDocument()
		expect(windowSize).toHaveTextContent("4000")

		expect(screen.getByText("(25%)")).toBeInTheDocument()
		expect(screen.getByTestId("context-tokens-used")).toHaveStyle({ width: "25%" })
	})
})
