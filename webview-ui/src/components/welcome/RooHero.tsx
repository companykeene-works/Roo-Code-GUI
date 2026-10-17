import { TerminalSquare } from "lucide-react"
import { useAppTranslation } from "@src/i18n/TranslationContext"

const RooHero = () => {
	const { t } = useAppTranslation()
	return (
		<div className="workspace-hero">
			<div className="workspace-wordmark"><TerminalSquare aria-hidden="true" /><span>Roo Code</span></div>
			<h1>{t("chat:workspace.heading")}</h1>
			<p>{t("chat:workspace.description")}</p>
		</div>
	)
}
export default RooHero
