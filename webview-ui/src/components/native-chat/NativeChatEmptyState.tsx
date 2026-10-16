import React from "react"
import { Sparkles, Code2, BrainCircuit, BookOpen, Compass } from "lucide-react"

interface NativeChatEmptyStateProps {
	onSelectStarter: (prompt: string) => void
}

const STARTERS = [
	{
		icon: Code2,
		title: "Code Analysis & Architecture",
		desc: "Review design patterns, refactoring options, or trade-offs.",
		prompt: "Can you analyze modern architectural patterns for separating background tasks from interactive UI, with pros and cons?",
	},
	{
		icon: BrainCircuit,
		title: "Model & Reasoning Capabilities",
		desc: "Explore differences between reasoning and non-reasoning models.",
		prompt: "How does test-time reasoning compute differ from pre-trained scale in solving complex software engineering tasks?",
	},
	{
		icon: BookOpen,
		title: "API Contracts & System Design",
		desc: "Draft schemas, protocol specs, or type interfaces.",
		prompt: "Help me design an idiomatic, strongly-typed TypeScript API contract for a resilient real-time streaming pipeline.",
	},
	{
		icon: Compass,
		title: "Algorithm & Concept Deep-Dive",
		desc: "Break down complex math, algorithms, or computer science concepts.",
		prompt: "Explain how CRDTs achieve conflict-free eventual consistency in distributed systems with code examples.",
	},
]

export const NativeChatEmptyState: React.FC<NativeChatEmptyStateProps> = ({ onSelectStarter }) => {
	return (
		<div className="flex flex-col items-center justify-center flex-1 px-6 py-12 max-w-2xl mx-auto text-center select-none">
			<div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-indigo-500/20 via-purple-500/10 to-transparent flex items-center justify-center mb-5 border border-indigo-500/20 shadow-lg shadow-indigo-500/5">
				<Sparkles className="w-7 h-7 text-indigo-400" />
			</div>

			<h2 className="text-xl font-semibold tracking-tight text-[var(--vscode-editor-foreground)] mb-2">
				Roo AI Chat
			</h2>
			<p className="text-sm text-[var(--vscode-descriptionForeground)] max-w-md mb-8 leading-relaxed">
				Fast, focused intelligence. Fully isolated from your agent workspace, file system, and task executions.
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
