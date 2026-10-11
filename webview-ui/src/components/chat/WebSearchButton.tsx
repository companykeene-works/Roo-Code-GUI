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
		? "Web search: REQUIRED for next message (Click to switch to Auto)"
		: isOff
		? "Web search: OFF (Click to switch to Auto)"
		: "Web search: AUTO (Click to force search for next message)"

	return (
		<StandardTooltip content={tooltipContent}>
			<button
				type="button"
				onClick={handleClick}
				disabled={disabled}
				aria-label={`Web Search (${mode})`}
				className={cn(
					"h-8 inline-flex items-center gap-1.5 relative whitespace-nowrap px-2 text-xs rounded-md border",
					isRequired
						? "bg-sky-500/15 border-sky-500/50 text-sky-400 font-semibold hover:bg-sky-500/25 shadow-xs"
						: "bg-transparent border-border/40 text-vscode-descriptionForeground hover:text-vscode-foreground hover:bg-vscode-toolbar-hoverBackground/60 hover:border-border/70",
					"transition-all duration-150 focus:outline-none focus-visible:ring-1 focus-visible:ring-vscode-focusBorder",
					disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
					className,
				)}>
				<Globe className={cn("size-3.5 shrink-0", isRequired ? "text-sky-400" : "opacity-80")} />
				<span className="font-medium">Web</span>
				{isRequired && (
					<span className="text-[9px] uppercase font-bold tracking-wider px-1 py-0.5 bg-sky-500/20 text-sky-300 rounded leading-none">
						REQ
					</span>
				)}
			</button>
		</StandardTooltip>
	)
}
