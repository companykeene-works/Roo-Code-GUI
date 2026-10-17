import React from "react"
import { VSCodeTextField, VSCodeLink } from "@vscode/webview-ui-toolkit/react"

import { type ProviderSettings } from "@roo-code/types"

interface QwenCodeProps {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
	simplifySettings?: boolean
}

export const QwenCode: React.FC<QwenCodeProps> = ({ apiConfiguration, setApiConfigurationField }) => {
	const defaultPath = "~/.qwen/oauth_creds.json"

	const handleInputChange = (e: Event | React.FormEvent<HTMLElement>) => {
		const element = e.target as HTMLInputElement
		setApiConfigurationField("qwenCodeOauthPath", element.value)
	}

	const handleBlur = (e: Event | React.FormEvent<HTMLElement>) => {
		const element = e.target as HTMLInputElement
		// If the field is empty on blur, set it to the default value
		if (!element.value || element.value.trim() === "") {
			setApiConfigurationField("qwenCodeOauthPath", defaultPath)
		}
	}

	return (
		<div className="flex flex-col gap-4">
			<div>
				<VSCodeTextField
					value={apiConfiguration?.qwenCodeOauthPath || ""}
					className="w-full mt-1"
					type="text"
					onInput={handleInputChange}
					onBlur={handleBlur}
					placeholder={defaultPath}>
					Ścieżka danych uwierzytelniających OAuth
				</VSCodeTextField>

				<p className="text-xs mt-1 text-vscode-descriptionForeground">
					Ścieżka pliku danych uwierzytelniających Qwen OAuth. Jeśli pozostawisz pole puste, zostanie użyta ścieżka ~/.qwen/oauth_creds.json.
				</p>

				<div className="text-xs text-vscode-descriptionForeground mt-3">
					Qwen Code wymaga uwierzytelnienia OAuth przez oficjalnego klienta Qwen. Najpierw skonfiguruj dane uwierzytelniające.
				</div>

				<div className="text-xs text-vscode-descriptionForeground mt-2">
					Aby rozpocząć:
					<br />
					1. Zainstaluj oficjalnego klienta Qwen
					<br />
					2. Zaloguj się na swoje konto
					<br />
					3. Dane OAuth zostaną zapisane automatycznie
				</div>

				<VSCodeLink
					href="https://github.com/QwenLM/qwen-code/blob/main/README.md"
					className="text-vscode-textLink-foreground mt-2 inline-block text-xs">
					Instrukcja konfiguracji
				</VSCodeLink>
			</div>
		</div>
	)
}
