import React from "react"
import { Check } from "lucide-react"
import { type ThemeType } from "@roo-code/types"
import { cn } from "@/lib/utils"

interface ThemeOption {
	id: ThemeType
	name: string
	description: string
	bgCanvas: string
	bgSurface: string
	accent: string
	textColor: string
	isLight?: boolean
}

const THEMES: ThemeOption[] = [
	{
		id: "linear-dark",
		name: "Grafitowy",
		description: "Neutralny grafit i łagodny kontrast",
		bgCanvas: "#202123",
		bgSurface: "#28292c",
		accent: "#3b82f6",
		textColor: "#edeef0",
	},
	{
		id: "oled-black",
		name: "Czerń OLED",
		description: "Głęboka czerń i wyraźny kontrast",
		bgCanvas: "#000000",
		bgSurface: "#0a0a0a",
		accent: "#3b82f6",
		textColor: "#ffffff",
	},
	{
		id: "midnight-navy",
		name: "Granatowy",
		description: "Ciemne powierzchnie z odcieniami granatu",
		bgCanvas: "#0d1117",
		bgSurface: "#161b22",
		accent: "#58a6ff",
		textColor: "#e6edf3",
	},
	{
		id: "cyberpunk",
		name: "Cyberpunk",
		description: "Ciemne tło z akcentami w kolorze cyjanu",
		bgCanvas: "#090d16",
		bgSurface: "#0f172a",
		accent: "#00f0ff",
		textColor: "#f1f5f9",
	},
	{
		id: "clean-light",
		name: "Jasny",
		description: "Jasne powierzchnie i delikatne szarości",
		bgCanvas: "#edeef0",
		bgSurface: "#ffffff",
		accent: "#2563eb",
		textColor: "#0f172a",
		isLight: true,
	},
]

interface ThemeSettingsProps {
	selectedTheme?: ThemeType
	onThemeChange: (theme: ThemeType) => void
}

export const ThemeSettings: React.FC<ThemeSettingsProps> = ({
	selectedTheme = "linear-dark",
	onThemeChange,
}) => {
	const handleSelect = (themeId: ThemeType) => {
		onThemeChange(themeId)
	}

	return (
		<div className="flex flex-col gap-3">
			<div className="text-sm font-medium text-vscode-foreground">Motyw i kolory</div>
			<div className="text-xs text-vscode-descriptionForeground">
				Wybierz wygląd całej aplikacji. Podgląd zobaczysz od razu; zatwierdź wybór przyciskiem „Zapisz”.
			</div>
			<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-1">
				{THEMES.map((theme) => {
					const isSelected = selectedTheme === theme.id

					return (
						<button
							key={theme.id}
							type="button"
							aria-pressed={isSelected}
							onClick={() => handleSelect(theme.id)}
							data-testid={`theme-card-${theme.id}`}
							className={cn(
								"theme-choice group relative flex flex-col p-3.5 rounded-xl border text-left transition-all duration-150 cursor-pointer select-none",
								isSelected
									? "border-blue-500 bg-blue-500/10 shadow-sm ring-1 ring-blue-500/40"
									: "border-white/[0.08] hover:border-white/[0.18] bg-white/[0.02] hover:bg-white/[0.04]",
							)}>
							{/* Theme Preview Swatch Bar */}
							<div
								className="w-full h-12 rounded-lg mb-3 p-2 flex items-center justify-between border"
								style={{
									backgroundColor: theme.bgCanvas,
									borderColor: theme.isLight ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.08)",
								}}>
								{/* Mini surface box inside swatch */}
								<div
									className="flex items-center gap-1.5 px-2 py-1 rounded-md border"
									style={{
										backgroundColor: theme.bgSurface,
										borderColor: theme.isLight ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.06)",
									}}>
									<div
										className="w-2.5 h-2.5 rounded-full"
										style={{ backgroundColor: theme.accent }}
									/>
									<span
										className="text-[10px] font-medium"
										style={{ color: theme.textColor }}>
										Aa
									</span>
								</div>

								{/* Palette Color Dots */}
								<div className="flex items-center gap-1">
									<div
										className="w-3.5 h-3.5 rounded-full border"
										style={{
											backgroundColor: theme.bgCanvas,
											borderColor: theme.isLight ? "rgba(0,0,0,0.2)" : "rgba(255,255,255,0.2)",
										}}
										title="Tło"
									/>
									<div
										className="w-3.5 h-3.5 rounded-full border"
										style={{
											backgroundColor: theme.bgSurface,
											borderColor: theme.isLight ? "rgba(0,0,0,0.2)" : "rgba(255,255,255,0.2)",
										}}
										title="Powierzchnia"
									/>
									<div
										className="w-3.5 h-3.5 rounded-full shadow-xs"
										style={{ backgroundColor: theme.accent }}
										title="Akcent"
									/>
								</div>
							</div>

							{/* Theme Info */}
							<div className="flex items-start justify-between gap-2">
								<div>
									<div className="flex items-center gap-1.5">
										<span className="text-sm font-semibold text-vscode-foreground">
											{theme.name}
										</span>
										{theme.id === "linear-dark" && (
											<span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/10 text-vscode-descriptionForeground font-medium">
												Domyślny
											</span>
										)}
									</div>
									<p className="text-xs text-vscode-descriptionForeground mt-0.5 leading-relaxed">
										{theme.description}
									</p>
								</div>

								{isSelected && (
									<div className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-500 text-white flex items-center justify-center shadow-xs">
										<Check className="w-3 h-3 stroke-[3]" />
									</div>
								)}
							</div>
						</button>
					)
				})}
			</div>
		</div>
	)
}
