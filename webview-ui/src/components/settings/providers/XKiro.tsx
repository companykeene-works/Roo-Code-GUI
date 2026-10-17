import { useCallback, useState, useRef, useEffect } from "react"
import { useEvent } from "react-use"
import { VSCodeTextField, VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { CheckCircle2, XCircle, Loader2 } from "lucide-react"

import type { ExtensionMessage, ProviderSettings } from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { VSCodeButtonLink } from "@src/components/common/VSCodeButtonLink"
import { vscode } from "@src/utils/vscode"

import { inputEventTransform } from "../transforms"

type XKiroProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
	simplifySettings?: boolean
}

export const XKiro = ({ apiConfiguration, setApiConfigurationField }: XKiroProps) => {
	const { t } = useAppTranslation()
	const [testStatus, setTestStatus] = useState<"idle" | "testing" | "success" | "error">("idle")
	const [testMessage, setTestMessage] = useState<string>("")
	const testTimeoutRef = useRef<NodeJS.Timeout | null>(null)

	useEffect(() => {
		return () => {
			if (testTimeoutRef.current) {
				clearTimeout(testTimeoutRef.current)
			}
		}
	}, [])

	const onMessage = useCallback((event: MessageEvent) => {
		const message: ExtensionMessage = event.data
		if (message?.type === "testConnectionResult") {
			if (testTimeoutRef.current) {
				clearTimeout(testTimeoutRef.current)
				testTimeoutRef.current = null
			}
			if (message.success) {
				setTestStatus("success")
				setTestMessage(message.text || "Połączono z API xKiro.")
			} else {
				setTestStatus("error")
				setTestMessage(message.error || message.text || "Nie udało się nawiązać połączenia.")
			}
		}
	}, [])

	useEvent("message", onMessage)

	const handleApiKeyChange = useCallback(
		(event: any) => {
			const val = inputEventTransform(event)
			setApiConfigurationField("xkiroApiKey", val)
			setApiConfigurationField("apiKey", val)
			if (testStatus !== "idle") {
				setTestStatus("idle")
				setTestMessage("")
			}
		},
		[setApiConfigurationField, testStatus],
	)

	const handleBaseUrlChange = useCallback(
		(event: any) => {
			const val = inputEventTransform(event)
			setApiConfigurationField("xkiroBaseUrl", val)
			if (testStatus !== "idle") {
				setTestStatus("idle")
				setTestMessage("")
			}
		},
		[setApiConfigurationField, testStatus],
	)

	const handleCustomContextWindowChange = useCallback(
		(event: any) => {
			const val = inputEventTransform(event)
			const parsed = parseInt(val, 10)
			setApiConfigurationField("xkiroCustomContextWindow", isNaN(parsed) || parsed <= 0 ? undefined : parsed)
		},
		[setApiConfigurationField],
	)

	const handleTestConnection = useCallback(() => {
		const apiKey = apiConfiguration?.xkiroApiKey || apiConfiguration?.apiKey || ""
		const baseUrl = (apiConfiguration?.xkiroBaseUrl || "https://api.xkiro.com/v1").trim().replace(/\/+$/, "")

		if (!apiKey) {
			setTestStatus("error")
			setTestMessage("Wpisz klucz API, aby sprawdzić połączenie.")
			return
		}

		setTestStatus("testing")
		setTestMessage("Sprawdzam połączenie z API xKiro…")

		if (testTimeoutRef.current) {
			clearTimeout(testTimeoutRef.current)
		}

		testTimeoutRef.current = setTimeout(() => {
			setTestStatus("error")
			setTestMessage("Przekroczono czas oczekiwania na odpowiedź serwera.")
			testTimeoutRef.current = null
		}, 12000)

		vscode.postMessage({
			type: "testConnection",
			values: {
				provider: "xkiro",
				baseUrl,
				apiKey,
			},
		})
	}, [apiConfiguration])

	return (
		<div className="space-y-3">
			<VSCodeTextField
				value={apiConfiguration?.xkiroApiKey || apiConfiguration?.apiKey || ""}
				type="password"
				onInput={handleApiKeyChange}
				placeholder="Wpisz klucz API xKiro (np. xkiro-…)"
				className="w-full">
				<label className="block font-medium mb-1">Klucz API xKiro</label>
			</VSCodeTextField>
			<div className="text-sm text-vscode-descriptionForeground -mt-1">
				Klucz API jest zapisywany w lokalnym magazynie danych uwierzytelniających.
			</div>

			<VSCodeTextField
				value={apiConfiguration?.xkiroBaseUrl || "https://api.xkiro.com/v1"}
				onInput={handleBaseUrlChange}
				placeholder="https://api.xkiro.com/v1"
				className="w-full">
				<label className="block font-medium mb-1">Adres API (opcjonalnie)</label>
			</VSCodeTextField>
			<div className="text-sm text-vscode-descriptionForeground -mt-1">
				Domyślny adres xKiro: <code>https://api.xkiro.com/v1</code>
			</div>

			<VSCodeTextField
				value={apiConfiguration?.xkiroCustomContextWindow?.toString() || ""}
				onInput={handleCustomContextWindowChange}
				placeholder="np. 1000000"
				className="w-full">
				<label className="block font-medium mb-1">{t("settings:providers.customContextWindow", "Custom Context Window (Optional)")}</label>
			</VSCodeTextField>
			<div className="text-sm text-vscode-descriptionForeground -mt-1">
				{t("settings:providers.customContextWindowDescription", "Ustaw rozmiar kontekstu w tokenach dla własnych lub nowo udostępnionych modeli.")}
			</div>

			<div className="flex flex-wrap items-center gap-3 pt-1">
				<VSCodeButton
					appearance="secondary"
					disabled={testStatus === "testing"}
					onClick={handleTestConnection}>
					{testStatus === "testing" ? (
						<span className="flex items-center gap-1.5">
							<Loader2 className="w-3.5 h-3.5 animate-spin" />
							{t("settings:providers.testingConnection", "Sprawdzam połączenie…")}
						</span>
					) : (
						t("settings:providers.testConnection", "Test Connection")
					)}
				</VSCodeButton>

				{!apiConfiguration?.xkiroApiKey && !apiConfiguration?.apiKey && (
					<VSCodeButtonLink href="https://xkiro.com" appearance="secondary">
						Otwórz xkiro.com
					</VSCodeButtonLink>
				)}
			</div>

			{testStatus === "success" && (
				<div className="flex items-center gap-2 p-2.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium">
					<CheckCircle2 className="w-4 h-4 flex-shrink-0 text-emerald-400" />
					<span>{testMessage}</span>
				</div>
			)}

			{testStatus === "error" && (
				<div className="flex items-center gap-2 p-2.5 rounded-md bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-medium">
					<XCircle className="w-4 h-4 flex-shrink-0 text-red-400" />
					<span>{testMessage}</span>
				</div>
			)}
		</div>
	)
}
