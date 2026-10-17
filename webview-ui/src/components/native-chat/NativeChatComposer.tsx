import React, { useRef, useState, useEffect } from "react"
import DynamicTextArea from "react-textarea-autosize"
import { SendHorizontal, Square, ImagePlus, Globe, Sparkles } from "lucide-react"
import type { ChatModelPreference, WebSearchMode } from "@roo-code/types"
import { vscode } from "@src/utils/vscode"
import Thumbnails from "@src/components/common/Thumbnails"
import { NativeChatModelPicker } from "./NativeChatModelPicker"

interface NativeChatComposerProps {
	sessionId?: string
	initialText?: string
	initialImages?: string[]
	initialWebSearchMode?: "off" | "auto" | "required"
	modelPreference?: ChatModelPreference
	onModelPreferenceChange: (pref: ChatModelPreference) => void
	isStreaming: boolean
	onSend: (text: string, images?: string[], webSearchMode?: "off" | "auto" | "required") => void
	onAbort: () => void
}

export const NativeChatComposer: React.FC<NativeChatComposerProps> = ({
	sessionId,
	initialText = "",
	initialImages = [],
	initialWebSearchMode = "auto",
	modelPreference,
	onModelPreferenceChange,
	isStreaming,
	onSend,
	onAbort,
}) => {
	const [text, setText] = useState(initialText)
	const [images, setImages] = useState<string[]>(initialImages)
	const [webSearchMode, setWebSearchMode] = useState<"off" | "auto" | "required">(initialWebSearchMode)
	const textareaRef = useRef<HTMLTextAreaElement>(null)

	// Sync initial state if session changes
	useEffect(() => {
		setText(initialText)
		setImages(initialImages)
		setWebSearchMode(initialWebSearchMode)
	}, [sessionId])

	// Auto-save draft debounced
	useEffect(() => {
		if (!sessionId) return
		const timeout = setTimeout(() => {
			vscode.postMessage({
				type: "chatSaveDraft",
				chatSessionId: sessionId,
				chatDraft: {
					text,
					images: images.length > 0 ? images : undefined,
					webSearchMode,
				},
			})
		}, 600)
		return () => clearTimeout(timeout)
	}, [sessionId, text, images, webSearchMode])

	const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault()
			handleSend()
		}
	}

	const handleSend = () => {
		if (isStreaming) {
			onAbort()
			return
		}
		if (!text.trim() && images.length === 0) return

		const toSend = text
		const toSendImages = images.length > 0 ? [...images] : undefined
		const toSendSearch = webSearchMode

		setText("")
		setImages([])
		onSend(toSend, toSendImages, toSendSearch)
	}

	const toggleWebSearch = () => {
		setWebSearchMode((prev) => {
			if (prev === "off") return "auto"
			if (prev === "auto") return "required"
			return "off"
		})
	}

	const handleSelectImages = () => {
		vscode.postMessage({ type: "selectImages" })
	}

	// Listen for selectedImages message from extension
	useEffect(() => {
		const handleMessage = (event: MessageEvent) => {
			const data = event.data
			if (data?.type === "selectedImages" && Array.isArray(data.images)) {
				setImages((prev) => [...prev, ...data.images])
			}
		}
		window.addEventListener("message", handleMessage)
		return () => window.removeEventListener("message", handleMessage)
	}, [])

	return (
		<div className="native-chat-composer p-3 sm:p-4 max-w-3xl mx-auto w-full select-none">
			<div className="relative rounded-2xl border border-[var(--vscode-editorWidget-border,rgba(255,255,255,0.1))] bg-[var(--vscode-input-background,rgba(255,255,255,0.03))] shadow-lg shadow-black/20 focus-within:border-[var(--vscode-focusBorder,#58a6ff)]/70 transition-all">
				{/* Images preview inside composer if attached */}
				{images.length > 0 && (
					<div className="p-2 border-b border-[var(--vscode-editorWidget-border,rgba(255,255,255,0.06))]">
						<Thumbnails images={images} setImages={setImages} />
					</div>
				)}

				{/* Auto-growing Textarea */}
				<div className="px-3 pt-3 pb-2">
					<DynamicTextArea
						ref={textareaRef}
						value={text}
						onChange={(e) => setText(e.target.value)}
						onKeyDown={handleKeyDown}
						placeholder="Napisz wiadomość… (Shift+Enter: nowy wiersz)"
						minRows={2}
						maxRows={10}
						className="w-full bg-transparent text-sm text-[var(--vscode-input-foreground,#cccccc)] placeholder-[var(--vscode-input-placeholderForeground,#888888)] resize-none outline-none leading-relaxed font-sans"
						disabled={isStreaming}
					/>
				</div>

				{/* Bottom Controls Bar */}
				<div className="flex items-center justify-between px-3 py-2 border-t border-[var(--vscode-editorWidget-border,rgba(255,255,255,0.04))]">
					{/* Left Options: Model Picker & Tools */}
					<div className="flex items-center gap-1.5 overflow-x-auto py-0.5">
						<NativeChatModelPicker
							value={modelPreference}
							onChange={onModelPreferenceChange}
							disabled={isStreaming}
						/>

						{/* Web Search Toggle */}
						<button
							type="button"
							onClick={toggleWebSearch}
							disabled={isStreaming}
							className={`flex items-center gap-1 px-2 py-1 text-xs rounded-md border transition-colors cursor-pointer ${
								webSearchMode === "required"
									? "bg-sky-500/20 text-sky-300 border-sky-500/40"
									: webSearchMode === "auto"
										? "bg-[var(--vscode-badge-background,rgba(255,255,255,0.05))] text-sky-400/80 border-transparent hover:border-sky-500/30"
										: "bg-transparent text-[var(--vscode-descriptionForeground)] opacity-50 border-transparent hover:opacity-80"
							}`}
							title={`Wyszukiwanie: ${({ off: "wyłączone", auto: "automatyczne", required: "zawsze" })[webSearchMode]} (kliknij, aby zmienić)`}
						>
							<Globe className="w-3.5 h-3.5 shrink-0" />
							<span className="text-[11px] capitalize">Internet: {({ off: "wyłączony", auto: "auto", required: "zawsze" })[webSearchMode]}</span>
						</button>

						{/* Add Image Button */}
						<button
							type="button"
							onClick={handleSelectImages}
							disabled={isStreaming}
							className="p-1.5 rounded-md text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-editor-foreground)] hover:bg-[var(--vscode-list-hoverBackground,rgba(255,255,255,0.08))] transition-colors cursor-pointer"
							title="Dodaj obrazy"
						>
							<ImagePlus className="w-3.5 h-3.5" />
						</button>
					</div>

					{/* Right Action: Send / Abort */}
					<div className="shrink-0 ml-2">
						{isStreaming ? (
							<button
								type="button"
								onClick={onAbort}
								className="flex items-center justify-center w-8 h-8 rounded-xl bg-red-600 hover:bg-red-500 text-white transition-transform active:scale-95 cursor-pointer shadow-sm"
								title="Zatrzymaj odpowiedź"
							>
								<Square className="w-3.5 h-3.5 fill-current" />
							</button>
						) : (
							<button
								type="button"
								onClick={handleSend}
								disabled={!text.trim() && images.length === 0}
								className="flex items-center justify-center w-8 h-8 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-30 disabled:hover:bg-indigo-600 text-white transition-all active:scale-95 cursor-pointer shadow-sm shadow-indigo-600/30 disabled:shadow-none"
								title="Wyślij wiadomość (Enter)"
							>
								<SendHorizontal className="w-4 h-4" />
							</button>
						)}
					</div>
				</div>
			</div>
		</div>
	)
}
