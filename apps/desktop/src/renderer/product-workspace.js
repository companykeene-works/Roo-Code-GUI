/* Product-level workflows shared by the shell. No engine or provider logic lives here. */
window.ProductWorkspace = {
	install(api) {
		const $ = (id) => document.getElementById(id)
		let modal = null
		let editor = null
		let previousFocus = null
		let cancelGuard = null
		const icon =
			'<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 7h6l2 2h10v11H3z"/><path d="M3 7V4h7l2 3"/></svg>'
		function notify(text) {
			let toast = $("product-toast")
			if (!toast) {
				toast = document.createElement("div")
				toast.id = "product-toast"
				toast.setAttribute("role", "status")
				document.body.append(toast)
			}
			toast.textContent = text
			toast.hidden = false
			clearTimeout(notify.timer)
			notify.timer = setTimeout(() => {
				toast.hidden = true
			}, 4000)
		}
		function close() {
			const cancel = cancelGuard
			cancelGuard = null
			cancel?.()
			modal?.remove()
			modal = null
			previousFocus?.focus?.()
		}
		function renameConversation(initialValue, save) {
			const body = dialog("Nazwa rozmowy", "Krótka nazwa ułatwi jej odnalezienie w historii.")
			body.innerHTML =
				'<form class="project-path-form"><label for="conversation-title-input">Tytuł</label><div class="product-input-action"><input id="conversation-title-input" required maxlength="120" autocomplete="off"></div><p class="product-inline-error" role="alert"></p><div class="product-form-actions"><button class="btn btn-primary" type="submit">Zapisz nazwę</button></div></form>'
			const input = body.querySelector("input")
			input.value = initialValue
			body.querySelector("form").onsubmit = async (event) => {
				event.preventDefault()
				const button = body.querySelector("[type=submit]")
				button.disabled = true
				try {
					if (!input.value.trim()) throw new Error("Wpisz tytuł rozmowy.")
					await save(input.value.trim())
					close()
				} catch (error) {
					body.querySelector("[role=alert]").textContent = error.message || "Nie udało się zapisać nazwy."
					button.disabled = false
				}
			}
			input.focus()
			input.select()
		}
		function dialog(title, description = "") {
			close()
			previousFocus = document.activeElement
			modal = document.createElement("div")
			modal.className = "product-backdrop"
			modal.innerHTML = `<section class="product-dialog" role="dialog" aria-modal="true" aria-labelledby="product-dialog-title"><header><div><h2 id="product-dialog-title"></h2><p></p></div><button type="button" class="product-icon-button" aria-label="Zamknij">×</button></header><div class="product-dialog-content"></div></section>`
			modal.querySelector("h2").textContent = title
			modal.querySelector("header p").textContent = description
			modal.querySelector("header button").onclick = close
			modal.addEventListener("mousedown", (event) => {
				if (event.target === modal) close()
			})
			modal.addEventListener("keydown", (event) => {
				if (event.key === "Escape") {
					event.preventDefault()
					event.stopPropagation()
					close()
				}
				if (event.key === "Tab") {
					const controls = [...modal.querySelectorAll("button,input,textarea,[href]")].filter(
						(el) => !el.disabled && el.offsetParent,
					)
					if (!controls.length) return
					if (event.shiftKey && document.activeElement === controls[0]) {
						event.preventDefault()
						controls.at(-1).focus()
					} else if (!event.shiftKey && document.activeElement === controls.at(-1)) {
						event.preventDefault()
						controls[0].focus()
					}
				}
			})
			document.body.append(modal)
			return modal.querySelector(".product-dialog-content")
		}
		async function pickFolder(input) {
			try {
				const value = await window.__desktopAPI?.pickFolder?.()
				if (value) input.value = value
				input.focus()
			} catch (error) {
				notify("Nie udało się otworzyć wyboru folderu. Wpisz ścieżkę ręcznie.")
			}
		}
		async function projects(initialPath, relocating = false) {
			if (!(await guardEditor())) return
			const current = initialPath || api.workspace()?.path || ""
			const body = dialog(
				relocating ? "Zmień lokalizację projektu" : "Projekty",
				relocating
					? "Wskaż folder, do którego projekt został przeniesiony. Rozmowy zachowają przypisanie. Pliki nie będą przenoszone."
					: "Otwórz folder z dysku albo wróć do jednego ze swoich projektów.",
			)
			body.innerHTML = `<form class="project-path-form"><label for="project-path-input">Folder projektu</label><div class="product-input-action"><input id="project-path-input" placeholder="C:\\Projekty\\mój-projekt" autocomplete="off" spellcheck="false"><button type="button" class="btn btn-secondary" id="project-browse">Wybierz…</button></div><p class="product-inline-error" role="alert"></p><div class="product-form-actions"><button type="button" class="product-text-button" id="project-quick">Utwórz pusty projekt</button><button class="btn btn-primary" type="submit">${relocating ? "Zapisz lokalizację" : "Otwórz projekt"}</button></div></form><div id="project-manager-list"></div>`
			const input = body.querySelector("input")
			input.value = relocating ? current : ""
			body.querySelector("#project-browse").onclick = () => pickFolder(input)
			body.querySelector("#project-quick").hidden = relocating
			body.querySelector("#project-quick").onclick = async () => {
				close()
				await api.quickProject()
			}
			const form = body.querySelector("form")
			form.onsubmit = async (event) => {
				event.preventDefault()
				const button = form.querySelector('[type="submit"]')
				const errorEl = form.querySelector('[role="alert"]')
				button.disabled = true
				errorEl.textContent = ""
				try {
					if (!input.value.trim()) throw new Error("Wpisz ścieżkę lub wybierz folder.")
					if (relocating) {
						const response = await fetch("/api/project/relocate", {
							method: "POST",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify({ oldPath: current, path: input.value.trim() }),
						})
						const result = await response.json()
						if (!response.ok) throw new Error(result.error)
					}
					if (!(await api.selectProject(input.value.trim())))
						throw new Error(
							"Nie udało się otworzyć projektu. Sprawdź, czy folder istnieje i jest dostępny.",
						)
					await api.refresh()
					close()
					notify(relocating ? "Zapisano nową lokalizację projektu" : "Projekt otwarty")
				} catch (error) {
					errorEl.textContent = error.message || "Nie udało się zapisać projektu."
					button.disabled = false
				}
			}
			if (!relocating) {
				const paths = api.projectPaths()
				for (const value of paths) {
					const row = document.createElement("div")
					row.className = "project-manager-row"
					const activate = document.createElement("button")
					activate.className = "project-manager-open"
					activate.type = "button"
					activate.innerHTML = `${icon}<span><strong></strong><small></small></span>`
					activate.querySelector("strong").textContent = api.projectName(value)
					activate.querySelector("small").textContent = value
					activate.onclick = async () => {
						input.value = value
						form.requestSubmit()
					}
					const manage = document.createElement("button")
					manage.type = "button"
					manage.className = "product-icon-button"
					manage.textContent = "…"
					manage.setAttribute("aria-label", `Zarządzaj projektem ${api.projectName(value)}`)
					manage.onclick = (event) => {
						close()
						api.projectMenu(event, value, manage)
					}
					row.append(activate, manage)
					body.querySelector("#project-manager-list").append(row)
				}
				if (api.workspace()?.path) {
					const leave = document.createElement("button")
					leave.type = "button"
					leave.className = "product-text-button project-close-current"
					leave.textContent = "Zamknij bieżący projekt"
					leave.onclick = async () => {
						if (await api.selectProject("")) {
							close()
							api.tab("chat")
							await api.refresh()
						}
					}
					body.append(leave)
				}
			}
			input.focus()
		}
		function attach(path) {
			if (!api.workspace()?.path) {
				projects()
				return
			}
			api.tab("chat")
			api.forward({
				type: "insertTextIntoTextarea",
				text: "@/" + path.replace(/\\/g, "/").replace(/ /g, "\\ ") + " ",
			})
			notify("Dodano plik do wiadomości")
		}
		async function guardEditor(restorePreview = true) {
			if (!editor) return true
			const release = () => {
				const file = editor?.path
				editor = null
				if (restorePreview && file) api.preview(file)
			}
			if (editor.content === editor.original) {
				release()
				return true
			}
			return new Promise((resolve) => {
				const body = dialog(
					"Niezapisane zmiany",
					"Zapisz plik przed przejściem dalej albo odrzuć zmiany w edytorze.",
				)
				cancelGuard = () => resolve(false)
				body.innerHTML =
					'<div class="product-form-actions"><button class="btn btn-secondary" id="editor-stay">Wróć do edycji</button><button class="btn btn-secondary" id="editor-discard">Odrzuć zmiany</button><button class="btn btn-primary" id="editor-save-prompt">Zapisz plik</button></div><p class="product-inline-error" role="alert"></p>'
				const dismiss = modal.querySelector("header button")
				const stay = () => {
					close()
					resolve(false)
				}
				dismiss.onclick = stay
				body.querySelector("#editor-stay").onclick = stay
				modal.addEventListener(
					"keydown",
					(event) => {
						if (event.key === "Escape") resolve(false)
					},
					true,
				)
				modal.addEventListener("mousedown", (event) => {
					if (event.target === modal) resolve(false)
				})
				body.querySelector("#editor-discard").onclick = () => {
					release()
					cancelGuard = null
					close()
					resolve(true)
				}
				body.querySelector("#editor-save-prompt").onclick = async () => {
					if ((await saveEditor()) && editor && editor.content === editor.original) {
						release()
						cancelGuard = null
						close()
						resolve(true)
					} else
						body.querySelector('[role="alert"]').textContent =
							"Nie udało się zapisać całej wersji. Sprawdź informację przy edytorze."
				}
			})
		}
		async function editFile(filePath) {
			if (!(await guardEditor(false))) return
			try {
				const response = await fetch("/api/editor?path=" + encodeURIComponent(filePath))
				const data = await response.json()
				if (!response.ok) throw new Error(data.error)
				editor = {
					path: filePath,
					content: data.content,
					original: data.content,
					revision: data.revision,
					workspace: api.workspace().path,
				}
				const area = $("preview-content-area")
				area.innerHTML =
					'<div class="project-editor"><div class="project-editor-toolbar"><span id="editor-state">Zapisano</span><button class="product-text-button" id="editor-save">Zapisz <kbd>Ctrl+S</kbd></button><button class="product-text-button" id="editor-close">Zamknij edytor</button></div><p id="editor-error" role="alert"></p><textarea id="project-file-editor" aria-label="Edytuj plik" spellcheck="false"></textarea></div>'
				const textarea = $("project-file-editor")
				textarea.value = editor.content
				textarea.oninput = () => {
					if (!editor || editor.path !== filePath) return
					editor.content = textarea.value
					$("editor-state").textContent =
						editor.content === editor.original ? "Zapisano" : "Niezapisane zmiany"
				}
				$("editor-save").onclick = saveEditor
				$("editor-close").onclick = async () => {
					const path = editor.path
					if (await guardEditor()) {
						editor = null
						api.preview(path)
					}
				}
				textarea.focus()
			} catch (error) {
				notify(error.message)
			}
		}
		async function saveEditor() {
			if (!editor) return true
			const saving = editor
			const content = saving.content
			const errorEl = $("editor-error")
			if (errorEl) errorEl.textContent = ""
			try {
				if (api.workspace().path !== editor.workspace)
					throw new Error("Projekt został zmieniony. Otwórz plik ponownie.")
				const response = await fetch("/api/editor?path=" + encodeURIComponent(saving.path), {
					method: "PUT",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ content, revision: saving.revision }),
				})
				const data = await response.json()
				if (response.status === 409)
					throw new Error(
						"Plik został zmieniony na dysku. Skopiuj swoje zmiany, zamknij edytor i otwórz plik ponownie. Twoja wersja pozostaje w edytorze.",
					)
				if (!response.ok) throw new Error(data.error)
				saving.original = content
				saving.revision = data.revision
				if ($("editor-state"))
					$("editor-state").textContent = saving.content === content ? "Zapisano" : "Niezapisane zmiany"
				notify("Zapisano plik")
				return true
			} catch (error) {
				if (errorEl) errorEl.textContent = error.message
				else notify(error.message)
				return false
			}
		}
		function palette() {
			const body = dialog("Przejdź do…", "Wyszukaj działanie, projekt lub plik.")
			body.classList.add("product-palette")
			body.innerHTML =
				'<input id="product-command-search" placeholder="Szukaj działań, projektów i plików…" aria-label="Szukaj działań, projektów i plików"><div class="product-command-list" role="listbox"></div>'
			const commands = [
				["Nowa rozmowa", "Rozmowy", () => api.newChat(api.workspace()?.path)],
				["Otwórz projekt", "Projekty", projects],
				["Pliki projektu", "Widoki", () => api.tab("files")],
				["Przejrzyj zmiany", "Widoki", () => api.tab("diffs")],
				["Terminal", "Widoki", () => api.tab("terminal")],
				["Ustawienia", "Konfiguracja", () => api.settings()],
				...api.projectPaths().map((path) => [api.projectName(path), path, () => api.selectProject(path)]),
				...(api.workspace()?.files || []).map((path) => [
					path,
					"Pliki",
					() => {
						api.tab("files")
						api.preview(path)
					},
				]),
			]
			const input = body.querySelector("input")
			const list = body.querySelector(".product-command-list")
			let selected = 0
			let matches = []
			function render() {
				matches = commands
					.filter((item) =>
						(item[0] + " " + item[1]).toLocaleLowerCase().includes(input.value.toLocaleLowerCase()),
					)
					.slice(0, 40)
				list.replaceChildren()
				selected = Math.min(selected, Math.max(0, matches.length - 1))
				if (!matches.length) {
					list.textContent = "Brak wyników. Spróbuj innej nazwy."
					return
				}
				matches.forEach(([title, detail, action], index) => {
					const button = document.createElement("button")
					button.type = "button"
					button.setAttribute("role", "option")
					button.setAttribute("aria-selected", String(index === selected))
					const name = document.createElement("span")
					name.textContent = title
					const meta = document.createElement("small")
					meta.textContent = detail
					button.append(name, meta)
					button.onclick = async () => {
						close()
						if (await guardEditor()) await action()
					}
					list.append(button)
				})
			}
			input.oninput = () => {
				selected = 0
				render()
			}
			input.onkeydown = (event) => {
				if (event.key === "ArrowDown" || event.key === "ArrowUp") {
					event.preventDefault()
					selected =
						(selected + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % Math.max(1, matches.length)
					render()
					list.children[selected]?.scrollIntoView({ block: "nearest" })
				}
				if (event.key === "Enter") {
					event.preventDefault()
					list.children[selected]?.click()
				}
			}
			render()
			input.focus()
		}
		$("project-switcher")?.addEventListener("click", () => projects())
		$("project-manager-button")?.addEventListener("click", () => projects())
		$("workspace-new-chat")?.addEventListener("click", async () => {
			if (await guardEditor()) await api.newChat(api.workspace()?.path)
		})
		$("workspace-command-button")?.addEventListener("click", palette)
		$("workspace-settings-button")?.addEventListener("click", () => api.settings())
		$("workspace-project-search")?.addEventListener("input", (event) => api.searchSidebar(event.target.value))
		$("preview-add-context-btn")?.addEventListener("click", () => {
			const file = api.selectedFile()
			if (file) attach(file)
		})
		$("preview-edit-btn")?.addEventListener("click", () => {
			const file = api.selectedFile()
			if (file) editFile(file)
		})
		$("files-refresh-btn")?.addEventListener("click", () => api.refreshFiles())
		$("footer-workspace-path")?.addEventListener("click", () => projects())
		document.addEventListener("keydown", (event) => {
			if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
				event.preventDefault()
				palette()
			}
			if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s" && editor) {
				event.preventDefault()
				saveEditor()
			}
			if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "o") {
				event.preventDefault()
				projects()
			}
		})
		window.addEventListener("beforeunload", (event) => {
			if (editor && editor.content !== editor.original) {
				event.preventDefault()
				event.returnValue = ""
			}
		})
		return {
			renameConversation,
			projects,
			palette,
			attach,
			notify,
			guardEditor,
			isEditing: () => !!editor,
			update() {
				const workspace = api.workspace()
				const button = $("project-switcher")
				if (!button) return
				button.querySelector("strong").textContent = workspace?.path
					? api.projectName(workspace.path)
					: "Wybierz projekt"
				button.querySelector("small").textContent = workspace?.path || "Otwórz folder, aby rozpocząć pracę"
				button.title = workspace?.path || "Otwórz projekt"
				$("workspace-new-chat").disabled = !workspace?.path && !api.isNativeChat()
			},
		}
	},
}
