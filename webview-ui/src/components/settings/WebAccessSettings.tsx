import React, { HTMLAttributes } from "react"
import { VSCodeCheckbox, VSCodeTextField, VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { SetCachedStateField } from "./types"
import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"
import { SearchableSetting } from "./SearchableSetting"
import { ExtensionStateContextType } from "@/context/ExtensionStateContext"

interface WebAccessSettingsProps extends HTMLAttributes<HTMLDivElement> {
	webSearchEnabled?: boolean
	webSearchProvider?: "brave" | "tavily" | "searxng"
	webSearchApiKey?: string
	webSearchSearxngUrl?: string
	webSearchMaxResults?: number
	setCachedStateField: SetCachedStateField<keyof ExtensionStateContextType>
}

export const WebAccessSettings = ({
	webSearchEnabled = false,
	webSearchProvider = "brave",
	webSearchApiKey = "",
	webSearchSearxngUrl = "",
	webSearchMaxResults = 5,
	setCachedStateField,
	...props
}: WebAccessSettingsProps) => {
	const { t } = useAppTranslation()

	const handleEnabledChange = (checked: boolean) => {
		setCachedStateField("webSearchEnabled", checked)
	}

	const handleProviderChange = (provider: "brave" | "tavily" | "searxng") => {
		setCachedStateField("webSearchProvider", provider)
	}

	const handleApiKeyChange = (apiKey: string) => {
		setCachedStateField("webSearchApiKey", apiKey)
	}

	const handleSearxngUrlChange = (url: string) => {
		setCachedStateField("webSearchSearxngUrl", url)
	}

	const handleMaxResultsChange = (valStr: string) => {
		const val = parseInt(valStr, 10)
		if (!isNaN(val)) {
			setCachedStateField("webSearchMaxResults", Math.min(20, Math.max(1, val)))
		}
	}

	return (
		<div {...props}>
			<SectionHeader>{t("settings:sections.webAccess", "Web Access")}</SectionHeader>

			<Section>
				<div className="space-y-6">
					{/* Enable Web Search Setting */}
					<SearchableSetting
						settingId="web-access-enable"
						section="webAccess"
						label={t("settings:webAccess.enable.label", "Enable Web Search & Fetch")}>
						<div className="flex flex-col gap-1">
							<VSCodeCheckbox
								checked={webSearchEnabled}
								onChange={(e: any) => handleEnabledChange(e.target.checked)}
								data-testid="web-search-enabled-checkbox">
								<span className="font-medium">
									{t("settings:webAccess.enable.label", "Enable Web Search & Fetch")}
								</span>
							</VSCodeCheckbox>
							<div className="text-vscode-descriptionForeground text-sm ml-5 mt-1">
								{t(
									"settings:webAccess.enable.description",
									"Allow Roo to search the web and fetch web pages independently of the model provider.",
								)}
							</div>
						</div>
					</SearchableSetting>

					{webSearchEnabled && (
						<div className="ml-5 space-y-4">
							{/* Provider Selection */}
							<SearchableSetting
								settingId="web-access-provider"
								section="webAccess"
								label={t("settings:webAccess.provider.label", "Search Provider")}>
								<div>
									<label className="block font-medium mb-1">
										{t("settings:webAccess.provider.label", "Search Provider")}
									</label>
									<VSCodeDropdown
										value={webSearchProvider}
										onChange={(e: any) => handleProviderChange(e.target.value)}
										className="w-full">
										<VSCodeOption value="brave">Brave Search API</VSCodeOption>
										<VSCodeOption value="tavily">Tavily Search</VSCodeOption>
										<VSCodeOption value="searxng">SearXNG (Self-hosted)</VSCodeOption>
									</VSCodeDropdown>
									<p className="text-vscode-descriptionForeground text-xs mt-1">
										{t(
											"settings:webAccess.provider.description",
											"Select the search backend to use for web queries.",
										)}
									</p>
								</div>
							</SearchableSetting>

							{/* API Key (Brave or Tavily) */}
							{(webSearchProvider === "brave" || webSearchProvider === "tavily") && (
								<SearchableSetting
									settingId="web-access-api-key"
									section="webAccess"
									label={t("settings:webAccess.apiKey.label", "API Key")}>
									<div>
										<label className="block font-medium mb-1">
											{t("settings:webAccess.apiKey.label", "API Key")}
										</label>
										<VSCodeTextField
											value={webSearchApiKey || ""}
											onInput={(e: any) => handleApiKeyChange(e.target.value)}
											placeholder={t(
												"settings:webAccess.apiKey.placeholder",
												"Enter API key...",
											)}
											className="w-full"
											type="password"
										/>
										<p className="text-vscode-descriptionForeground text-xs mt-1">
											{t(
												"settings:webAccess.apiKey.description",
												"Stored securely in VS Code SecretStorage and never shared in chat.",
											)}{" "}
											{webSearchProvider === "brave" ? (
												<a
													href="https://brave.com/search/api/"
													target="_blank"
													rel="noopener noreferrer"
													className="text-vscode-textLink-foreground hover:text-vscode-textLink-activeForeground">
													brave.com/search/api
												</a>
											) : (
												<a
													href="https://tavily.com"
													target="_blank"
													rel="noopener noreferrer"
													className="text-vscode-textLink-foreground hover:text-vscode-textLink-activeForeground">
													tavily.com
												</a>
											)}
										</p>
									</div>
								</SearchableSetting>
							)}

							{/* SearXNG Instance URL */}
							{webSearchProvider === "searxng" && (
								<SearchableSetting
									settingId="web-access-searxng-url"
									section="webAccess"
									label={t("settings:webAccess.searxngUrl.label", "SearXNG URL")}>
									<div>
										<label className="block font-medium mb-1">
											{t("settings:webAccess.searxngUrl.label", "SearXNG URL")}
										</label>
										<VSCodeTextField
											value={webSearchSearxngUrl || ""}
											onInput={(e: any) => handleSearxngUrlChange(e.target.value)}
											placeholder="http://localhost:8080 or https://searx.example.com"
											className="w-full"
										/>
										<p className="text-vscode-descriptionForeground text-xs mt-1">
											{t(
												"settings:webAccess.searxngUrl.description",
												"The base URL of your SearXNG instance with JSON format enabled.",
											)}
										</p>
									</div>
								</SearchableSetting>
							)}

							{/* Max Results */}
							<SearchableSetting
								settingId="web-access-max-results"
								section="webAccess"
								label={t("settings:webAccess.maxResults.label", "Max Results")}>
								<div className="w-32">
									<label className="block font-medium mb-1">
										{t("settings:webAccess.maxResults.label", "Max Results")}
									</label>
									<VSCodeTextField
										value={String(webSearchMaxResults ?? 5)}
										onInput={(e: any) => handleMaxResultsChange(e.target.value)}
										className="w-full"
									/>
									<p className="text-vscode-descriptionForeground text-xs mt-1">
										{t(
											"settings:webAccess.maxResults.description",
											"Number of search results to return (1-20).",
										)}
									</p>
								</div>
							</SearchableSetting>
						</div>
					)}
				</div>
			</Section>
		</div>
	)
}
