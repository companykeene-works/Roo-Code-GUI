import React from "react"
import { Sparkles, Code2, BrainCircuit, BookOpen, Compass } from "lucide-react"

interface NativeChatEmptyStateProps {
	onSelectStarter: (prompt: string) => void
}

const STARTERS = [
	{
		icon: Code2,
		title: "Analiza kodu i architektury",
		desc: "Porównaj rozwiązania i zaplanuj refaktoryzację.",
		prompt: "Porównaj wzorce architektoniczne oddzielające zadania w tle od interfejsu użytkownika. Opisz ich zalety i ograniczenia.",
	},
	{
		icon: BrainCircuit,
		title: "Modele i rozumowanie",
		desc: "Poznaj możliwości i różnice między modelami.",
		prompt: "Wyjaśnij, jak dodatkowe rozumowanie podczas generowania odpowiedzi wpływa na rozwiązywanie złożonych zadań programistycznych.",
	},
	{
		icon: BookOpen,
		title: "Projektowanie API",
		desc: "Opracuj schematy, protokoły i typy.",
		prompt: "Pomóż mi zaprojektować typowany kontrakt API w TypeScript dla odpornego na błędy strumieniowania danych w czasie rzeczywistym.",
	},
	{
		icon: Compass,
		title: "Algorytmy i koncepcje",
		desc: "Zrozum trudne zagadnienia na przykładach.",
		prompt: "Wyjaśnij, jak CRDT zapewniają spójność w systemach rozproszonych. Pokaż przykłady kodu.",
	},
]

export const NativeChatEmptyState: React.FC<NativeChatEmptyStateProps> = ({ onSelectStarter }) => {
	return (
		<div className="native-chat-empty flex flex-col items-center justify-center flex-1 px-6 py-12 max-w-2xl mx-auto text-center select-none">
			<div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-indigo-500/20 via-purple-500/10 to-transparent flex items-center justify-center mb-5 border border-indigo-500/20 shadow-lg shadow-indigo-500/5">
				<Sparkles className="w-7 h-7 text-indigo-400" />
			</div>

			<h2 className="text-xl font-semibold tracking-tight text-[var(--vscode-editor-foreground)] mb-2">
				O czym porozmawiamy?
			</h2>
			<p className="text-sm text-[var(--vscode-descriptionForeground)] max-w-md mb-8 leading-relaxed">
				Porozmawiaj o pomysłach, kodzie i rozwiązaniach. Ten czat ma własny kontekst i nie wprowadza zmian w plikach projektu.
			</p>

			<div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full text-left">
				{STARTERS.map((s, idx) => {
					const Icon = s.icon
					return (
						<button
							key={idx}
							onClick={() => onSelectStarter(s.prompt)}
							className="group relative flex flex-col p-3.5 rounded-xl border border-[var(--vscode-editorWidget-border,rgba(255,255,255,0.08))] bg-[var(--vscode-editorWidget-background,rgba(255,255,255,0.03))] hover:bg-[var(--vscode-list-hoverBackground,rgba(255,255,255,0.06))] hover:border-[var(--vscode-focusBorder,#58a6ff)]/50 transition-all duration-150 cursor-pointer shadow-sm"
						>
							<div className="flex items-center gap-2.5 mb-1.5">
								<Icon className="w-4 h-4 text-indigo-400 group-hover:text-indigo-300 transition-colors" />
								<span className="text-xs font-semibold text-[var(--vscode-editor-foreground)] tracking-tight">
									{s.title}
								</span>
							</div>
							<p className="text-[11.5px] text-[var(--vscode-descriptionForeground)] line-clamp-2 leading-snug">
								{s.desc}
							</p>
						</button>
					)
				})}
			</div>
		</div>
	)
}
