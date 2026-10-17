import React, { useState } from "react"
import { Check, ChevronDown, Cpu, Sparkles, Sliders } from "lucide-react"
import type { ChatModelPreference, ProviderName } from "@roo-code/types"
import { Popover, PopoverContent, PopoverTrigger } from "@src/components/ui/popover"

interface ModelOption {
	id: string
	name: string
	provider: ProviderName
	description?: string
	supportsReasoning?: boolean
}

const CHAT_MODELS: Record<string, ModelOption[]> = {
	xkiro: [
		{
			id: "openai/gpt-5.6-terra",
			name: "GPT-5.6 Terra",
			provider: "xkiro",
			description: "Szybki model do codziennej pracy",
			supportsReasoning: true,
		},
		{
			id: "openai/gpt-6.1-sol",
			name: "GPT-6.1 Sol",
			provider: "xkiro",
			description: "Zaawansowane rozumowanie",
			supportsReasoning: true,
		},
		{
			id: "anthropic/claude-3.7-sonnet",
			name: "Claude 3.7 Sonnet",
			provider: "xkiro",
			description: "Rozumowanie i programowanie",
			supportsReasoning: true,
		},
		{
			id: "deepseek/deepseek-r1",
			name: "DeepSeek R1",
			provider: "xkiro",
			description: "Zaawansowany model otwarty",
			supportsReasoning: true,
		},
		{
			id: "deepseek/deepseek-chat",
			name: "DeepSeek V3",
			provider: "xkiro",
			description: "Szybkie rozmowy ogólne",
			supportsReasoning: false,
		},
	],
	openrouter: [
		{
			id: "openrouter/auto",
			name: "OpenRouter Auto",
			provider: "openrouter",
			description: "Automatyczny wybór dostępnego modelu",
			supportsReasoning: false,
		},
		{
			id: "anthropic/claude-3.7-sonnet",
			name: "Claude 3.7 Sonnet",
			provider: "openrouter",
			description: "Zaawansowany model Anthropic",
			supportsReasoning: true,
		},
		{
			id: "openai/gpt-4o",
			name: "GPT-4o",
			provider: "openrouter",
			description: "Model multimodalny",
			supportsReasoning: false,
		},
		{
			id: "google/gemini-2.5-pro",
			name: "Gemini 2.5 Pro",
			provider: "openrouter",
			description: "Duży kontekst i analiza",
			supportsReasoning: true,
		},
	],
	anthropic: [
		{
			id: "claude-3-7-sonnet-20250219",
			name: "Claude 3.7 Sonnet",
			provider: "anthropic",
			description: "Zaawansowany model",
			supportsReasoning: true,
		},
		{
			id: "claude-3-5-sonnet-20241022",
			name: "Claude 3.5 Sonnet",
			provider: "anthropic",
			description: "Programowanie i analiza",
			supportsReasoning: false,
		},
		{
			id: "claude-3-5-haiku-20241022",
			name: "Claude 3.5 Haiku",
			provider: "anthropic",
			description: "Lekki i szybki model",
			supportsReasoning: false,
		},
	],
	"openai-native": [
		{
			id: "gpt-4o",
			name: "GPT-4o",
			provider: "openai-native",
			description: "Multimodalny model OpenAI",
			supportsReasoning: false,
		},
		{
			id: "o3-mini",
			name: "o3-mini",
			provider: "openai-native",
			description: "Nauki ścisłe i programowanie",
			supportsReasoning: true,
		},
		{
			id: "o1",
			name: "o1",
			provider: "openai-native",
			description: "Złożone rozumowanie",
			supportsReasoning: true,
		},
	],
	deepseek: [
		{
			id: "deepseek-chat",
			name: "DeepSeek V3",
			provider: "deepseek",
			description: "Rozmowy i programowanie",
			supportsReasoning: false,
		},
		{
			id: "deepseek-reasoner",
			name: "DeepSeek R1",
			provider: "deepseek",
			description: "Zaawansowane rozumowanie",
			supportsReasoning: true,
		},
	],
	gemini: [
		{
			id: "gemini-2.5-flash",
			name: "Gemini 2.5 Flash",
			provider: "gemini",
			description: "Szybki model multimodalny",
			supportsReasoning: true,
		},
		{
			id: "gemini-2.5-pro",
			name: "Gemini 2.5 Pro",
			provider: "gemini",
			description: "Rozumowanie i duży kontekst",
			supportsReasoning: true,
		},
	],
}

interface NativeChatModelPickerProps {
	value?: ChatModelPreference
	onChange: (pref: ChatModelPreference) => void
	disabled?: boolean
}

export const NativeChatModelPicker: React.FC<NativeChatModelPickerProps> = ({ value, onChange, disabled = false }) => {
	const [isOpen, setIsOpen] = useState(false)

	const currentProvider: ProviderName = (value?.apiProvider as ProviderName) || "xkiro"
	const currentModelId = value?.modelId || "openai/gpt-5.6-terra"
	const currentEffort = value?.reasoningEffort || "medium"

	// Find active model info
	const providerModels = CHAT_MODELS[currentProvider] || []
	const activeModel = providerModels.find((m) => m.id === currentModelId) || {
		id: currentModelId,
		name: currentModelId.split("/").pop() || currentModelId,
		provider: currentProvider,
		supportsReasoning: false,
	}

	const handleSelectModel = (model: ModelOption) => {
		onChange({
			apiProvider: model.provider,
			modelId: model.id,
			reasoningEffort: model.supportsReasoning ? currentEffort : undefined,
			webSearchMode: value?.webSearchMode || "auto",
		})
	}

	const handleSelectEffort = (effort: "none" | "low" | "medium" | "high") => {
		onChange({
			apiProvider: currentProvider,
			modelId: currentModelId,
			reasoningEffort: effort,
			webSearchMode: value?.webSearchMode || "auto",
		})
	}

	return (
		<Popover open={isOpen} onOpenChange={setIsOpen}>
			<PopoverTrigger asChild>
				<button
					type="button"
					disabled={disabled}
					className="agent-toolbar-control flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md bg-[var(--vscode-badge-background,rgba(255,255,255,0.06))] hover:bg-[var(--vscode-list-hoverBackground,rgba(255,255,255,0.1))] text-[var(--vscode-editor-foreground)] border border-[var(--vscode-editorWidget-border,rgba(255,255,255,0.08))] transition-colors cursor-pointer select-none max-w-[220px]"
					title={`Dostawca: ${currentProvider} | Model: ${activeModel.name}`}>
					<Cpu className="w-3.5 h-3.5 text-[var(--text-secondary)] shrink-0" />
					<span className="truncate font-medium">{activeModel.name}</span>
					{activeModel.supportsReasoning && currentEffort && currentEffort !== "none" && (
						<span className="text-[10px] px-1 py-0.2 rounded bg-[var(--bg-hover)] text-[var(--text-secondary)] capitalize shrink-0">
							{(
								{
									none: "Brak",
									minimal: "Minimalny",
									low: "Niski",
									medium: "Średni",
									high: "Wysoki",
									xhigh: "Bardzo wysoki",
								} as Record<string, string>
							)[currentEffort] || currentEffort}
						</span>
					)}
					<ChevronDown className="w-3 h-3 text-[var(--vscode-descriptionForeground)] shrink-0 ml-0.5" />
				</button>
			</PopoverTrigger>

			<PopoverContent
				align="start"
				className="w-72 p-2 bg-[var(--vscode-editorWidget-background,#1e1e1e)] border border-[var(--vscode-editorWidget-border,rgba(255,255,255,0.1))] rounded-lg shadow-xl text-[var(--vscode-editor-foreground)] z-50">
				<div className="flex items-center justify-between px-2 py-1 mb-1 border-b border-[var(--vscode-editorWidget-border,rgba(255,255,255,0.06))]">
					<span className="text-[11px] font-medium text-[var(--vscode-descriptionForeground)]">
						Model rozmowy
					</span>
					<span className="text-[10px] text-[var(--text-muted)] font-medium">Osobny kontekst</span>
				</div>

				<div className="max-h-60 overflow-y-auto py-1 space-y-3">
					{Object.entries(CHAT_MODELS).map(([providerKey, models]) => (
						<div key={providerKey}>
							<div className="text-[11px] font-medium px-2 py-1.5 text-[var(--vscode-descriptionForeground)]">
								{providerKey.toUpperCase()}
							</div>
							<div className="space-y-0.5">
								{models.map((model) => {
									const isSelected = currentProvider === model.provider && currentModelId === model.id
									return (
										<button
											key={model.id}
											type="button"
											onClick={() => handleSelectModel(model)}
											className={`w-full flex items-center justify-between px-2 py-1.5 rounded text-left text-xs transition-colors cursor-pointer ${
												isSelected
													? "bg-[var(--vscode-list-activeSelectionBackground,#094771)] text-[var(--vscode-list-activeSelectionForeground,#ffffff)]"
													: "hover:bg-[var(--vscode-list-hoverBackground,rgba(255,255,255,0.05))]"
											}`}>
											<div className="truncate pr-2">
												<div className="font-medium truncate">{model.name}</div>
												{model.description && (
													<div className="text-[10px] opacity-70 truncate">
														{model.description}
													</div>
												)}
											</div>
											{isSelected && <Check className="w-3.5 h-3.5 shrink-0" />}
										</button>
									)
								})}
							</div>
						</div>
					))}
				</div>

				{/* Poziom rozumowania Selector */}
				{activeModel.supportsReasoning && (
					<div className="mt-2 pt-2 border-t border-[var(--vscode-editorWidget-border,rgba(255,255,255,0.06))] px-2">
						<div className="flex items-center gap-1 text-[11px] font-medium text-[var(--vscode-descriptionForeground)] mb-1.5">
							<Sliders className="w-3 h-3 text-[var(--text-secondary)]" />
							<span>Poziom rozumowania</span>
						</div>
						<div className="grid grid-cols-4 gap-1">
							{(["none", "low", "medium", "high"] as const).map((eff) => (
								<button
									key={{ none: "Brak", low: "Niski", medium: "Średni", high: "Wysoki" }[eff]}
									type="button"
									onClick={() => handleSelectEffort(eff)}
									className={`text-[10.5px] py-1 rounded font-medium capitalize text-center transition-colors cursor-pointer ${
										currentEffort === eff
											? "bg-[var(--text-primary)] text-[var(--bg-canvas)] font-semibold"
											: "bg-[var(--vscode-badge-background,rgba(255,255,255,0.05))] hover:bg-[var(--vscode-list-hoverBackground,rgba(255,255,255,0.1))] text-[var(--vscode-editor-foreground)]"
									}`}>
									{{ none: "Brak", low: "Niski", medium: "Średni", high: "Wysoki" }[eff]}
								</button>
							))}
						</div>
					</div>
				)}
			</PopoverContent>
		</Popover>
	)
}
