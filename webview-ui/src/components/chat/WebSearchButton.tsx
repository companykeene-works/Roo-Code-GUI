import React from "react"
import { Globe } from "lucide-react"
import { WebSearchMode } from "@roo-code/types"
import { StandardTooltip } from "@/components/ui"
import { cn } from "@/lib/utils"

interface WebSearchButtonProps {
	mode?: WebSearchMode
	onChange?: (mode: WebSearchMode) => void
	disabled?: boolean
	className?: string
}

export const WebSearchButton: React.FC<WebSearchButtonProps> = ({
	mode = "auto",
	onChange,
	disabled = false,
	className,
}) => {
	const isRequired = mode === "required"
	const isOff = mode === "off"

	const handleClick = (e: React.MouseEvent) => {
		e.preventDefault()
		if (disabled || !onChange) return
		if (mode === "auto") {
			onChange("required")
		} else if (mode === "required") {
			onChange("auto")
		} else {
			onChange("auto")
		}
	}

	const tooltipContent = isRequired
		? "Wyszukaj przed kolejną odpowiedzią. Kliknij, aby włączyć tryb automatyczny."
		: isOff
			? "Internet wyłączony. Kliknij, aby włączyć tryb automatyczny."
			: "Automatyczne wyszukiwanie. Kliknij, aby wyszukać przed kolejną odpowiedzią."

	return (
		<StandardTooltip content={tooltipContent}>
			<button
				type="button"
				onClick={handleClick}
				disabled={disabled}
				aria-pressed={isRequired}
				aria-label={`Wyszukiwanie: ${mode === "required" ? "zawsze" : mode === "off" ? "wyłączone" : "automatyczne"}`}
				className={cn("agent-toolbar-control shrink-0", className)}>
				<Globe className={cn("size-3.5 shrink-0", "text-current")} />
				<span className="font-medium">Internet</span>
				{isRequired && <span className="web-search-state">Zawsze</span>}
			</button>
		</StandardTooltip>
	)
}
