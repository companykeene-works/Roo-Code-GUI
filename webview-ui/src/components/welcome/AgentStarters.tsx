import { ArrowUpRight, FolderSearch, ListTodo, Wrench } from "lucide-react"
import { useAppTranslation } from "@src/i18n/TranslationContext"

export const AgentStarters = ({ onSelect }: { onSelect: (prompt: string) => void }) => {
	const { t } = useAppTranslation()
	return <>
		<div className="agent-starters">
			{[{ key: "explore", Icon: FolderSearch }, { key: "plan", Icon: ListTodo }, { key: "fix", Icon: Wrench }].map(({ key, Icon }) => (
				<button type="button" className="agent-starter" key={key} onClick={() => onSelect(t(`chat:workspace.${key}Prompt`))}>
					<Icon aria-hidden="true" /><span>{t(`chat:workspace.${key}`)}</span><ArrowUpRight className="starter-arrow" aria-hidden="true" />
				</button>
			))}
		</div>
		<div className="agent-home-note"><span><kbd>@</kbd> {t("chat:workspace.mention")}</span><span><kbd>/</kbd> {t("chat:workspace.commands")}</span></div>
	</>
}
