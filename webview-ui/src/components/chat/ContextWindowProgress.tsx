import { useMemo } from "react"
import { useTranslation } from "react-i18next"

import { formatLargeNumber } from "@/utils/format"
import { calculateTokenDistribution } from "@/utils/model-utils"
import { StandardTooltip } from "@/components/ui"
import { cn } from "@/lib/utils"

interface ContextWindowProgressProps {
	contextWindow: number
	contextTokens: number
	maxTokens?: number
	className?: string
}

export const ContextWindowProgress = ({
	contextWindow,
	contextTokens,
	maxTokens,
	className,
}: ContextWindowProgressProps) => {
	const { t } = useTranslation()

	// Use the shared utility function to calculate all token distribution values
	const tokenDistribution = useMemo(
		() => calculateTokenDistribution(contextWindow, contextTokens, maxTokens),
		[contextWindow, contextTokens, maxTokens],
	)

	// Destructure the values we need
	const { currentPercent, availableSize, reservedForOutput } = tokenDistribution

	// For display purposes
	const safeContextWindow = Math.max(0, contextWindow)
	const safeContextTokens = Math.max(0, contextTokens)
	const percent = safeContextWindow > 0 ? Math.min(100, Math.round((safeContextTokens / safeContextWindow) * 100)) : 0

	const tone = percent > 85 ? "danger" : percent >= 60 ? "warning" : "neutral"

	// Full breakdown inside StandardTooltip on hover
	const tooltipContent = (
		<div className="space-y-1 text-xs">
			<div>
				{t("chat:tokenProgress.tokensUsed", {
					used: formatLargeNumber(safeContextTokens),
					total: formatLargeNumber(safeContextWindow),
				})}{" "}
				({percent}%)
			</div>
			{reservedForOutput > 0 && (
				<div>
					{t("chat:tokenProgress.reservedForResponse", {
						amount: formatLargeNumber(reservedForOutput),
					})}
				</div>
			)}
			{availableSize > 0 && (
				<div>
					{t("chat:tokenProgress.availableSpace", {
						amount: formatLargeNumber(availableSize),
					})}
				</div>
			)}
		</div>
	)

	return (
		<StandardTooltip content={tooltipContent} side="top" sideOffset={8}>
			<div className={cn("context-meter select-none", className)} data-tone={tone}>
				<span data-testid="context-tokens-count" className="font-mono text-vscode-foreground">
					{formatLargeNumber(safeContextTokens)}
				</span>
				<span className="text-vscode-descriptionForeground opacity-70">/</span>
				<span data-testid="context-window-size" className="font-mono text-vscode-foreground">
					{formatLargeNumber(safeContextWindow)}
				</span>
				<span className="context-meter-percent">({percent}%)</span>
				<div className="context-meter-bar shrink-0">
					<span
						style={{ width: `${Math.min(100, Math.max(0, currentPercent))}%` }}
						data-testid="context-tokens-used"
					/>
				</div>
			</div>
		</StandardTooltip>
	)
}
