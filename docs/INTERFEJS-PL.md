# Roo Code — polski interfejs desktopowy

Przebudowa obejmuje okno Electron i osadzony interfejs React. Wspólny plik `apps/desktop/src/renderer/design-tokens.css` określa kolory, typografię i podstawowe style motywów. `workspace.css` w każdej z warstw odpowiada za układ i komponenty tej warstwy.

## Zmiany

- Neutralna grafitowa paleta, spokojniejsza nawigacja, czytelniejszy panel projektów i rozmów.
- Nowy ekran startowy z podpowiedziami, które uzupełniają pole wiadomości; wysyłanie nadal wymaga działania użytkownika.
- Większy edytor wiadomości; kontrolki modelu i narzędzi zawijają się na węższych oknach.
- Spójne formularze, menu, przyciski, podglądy i ustawienia w pięciu zachowanych motywach.
- Systemowe czcionki Windows, dostępne bez połączenia z internetem; obsługa ograniczania animacji i widoczny fokus klawiatury.
- Polski jako język startowy, także przy pierwszym uruchomieniu tej edycji na istniejącej konfiguracji. Nazwy modeli, dostawców i technologii zachowano.
- Uzupełnione zasoby tłumaczeń oraz teksty wpisane bezpośrednio w komponentach i natywnych menu.
- Ustawienia korzystają z bufora `cachedState`. Podgląd motywu synchronizuje okno i oba osadzone widoki, a odrzucenie zmian przywraca wygląd wynikający z bufora.
- Automatyczny komunikat o zakończeniu rozwoju oryginalnego rozszerzenia nie zasłania startu samodzielnej aplikacji.

## Budowanie

W katalogu głównym repozytorium:

```powershell
pnpm install --frozen-lockfile
pnpm --filter @roo-code/build build
pnpm --filter @roo-code/types build
pnpm --filter @roo-code/desktop package:win
```

Instalator trafia do `apps/desktop/release/`. Zawiera Electron, silnik agenta, interfejs i ripgrep. Użytkownik końcowy nie potrzebuje Node.js, pnpm ani VS Code.

Wersję bez instalacji można przygotować z tego samego buildu:

```powershell
pnpm --filter @roo-code/desktop exec electron-builder --prepackaged release/win-unpacked --win portable --x64
```

W konfiguracji pnpm zawężono nadpisanie `brace-expansion` do starych wersji. Wymuszanie wersji 2 dla nowego `minimatch` blokowało pakowanie. Instalator startuje po polsku; angielskie zasoby dołączono na potrzeby zgodności kompilatora NSIS, bez wyświetlania wyboru języka.

## Weryfikacja

```powershell
node scripts/audit-polish.mjs
pnpm --filter @roo-code/desktop check-types
pnpm --filter @roo-code/desktop test
```

Audyt sprawdza kompletność 1819 kluczy zasobów polskich w interfejsie i silniku oraz zgodność parametrów interpolacji. Nazwy własne i treści pochodzące od użytkownika, modelu, API lub terminala nie są automatycznie tłumaczone.

`scripts/launch-design-preview.mjs` uruchamia aplikację na porcie 5993 z osobnymi danymi w `.design-qa/`. Opcja `--packaged` wybiera plik z `release/win-unpacked`. `scripts/test-design-runtime.mjs` sprawdza za pomocą protokołu testowego Electron ekran startowy, podpowiedzi, pliki, widoki zmian i terminala, czat, motywy oraz węższy układ. Zapisuje wyniki i zrzuty w `.design-qa/`.

Opcja `--portable` uruchamia gotowy plik `Roo-Code-PL-Portable-1.0.0-x64.exe`. W tej wersji potwierdzono również przejście testów uruchomieniowych. Łącznie przeszło 199 testów desktopowych i 29 wybranych testów UI; kompilacja produkcyjna obejmuje kontrolę typów interfejsu.

Testy interfejsu nie wysyłają płatnych zapytań do zewnętrznych modeli. Rozmowy z wybranym dostawcą wymagają skonfigurowania jego klucza API, tak jak przed przebudową.

Build jest lokalny i nie ma podpisu cyfrowego wydawcy.

## Panel modeli

Panel używa jednej listy z wierszami o wysokości co najmniej 64 px. Nazwa i subtelne oznaczenie możliwości są oddzielone od dostawcy i wyrównanego kontekstu. Ostatnio używane modele nie powtarzają się w pozostałych sekcjach. Wyszukiwarka otrzymuje fokus przy otwarciu; strzałki, Home i End przechodzą między modelami, Enter wybiera, a Escape zamyka panel. Filtry uwzględniają modele mające kilka możliwości jednocześnie.

Główna lista jest podzielona na rodziny GPT, Claude, Gemini, Qwen, Grok, Llama (Meta), DeepSeek i inne. Nagłówki zawierają firmę, lokalny monochromatyczny znak lub monogram i liczbę modeli. Grupy startują zwinięte; wyszukiwanie i filtry rozwijają wyniki. Ostatnie i polecane modele są osobnymi, również zwijanymi sekcjami. Klawiatura pomija ukryte wiersze.

Sortowanie porównuje osobno liczby w generacji (np. 5.10 i 5.9), potem wariant modelu i identyfikator. Zwykły model pojawia się przed jego wariantem `:batch`; sufiksy `:batch`, `:free` itd. są widoczne przy nazwie. Wybrany model otrzymuje podpis, znacznik i subtelny kolor akcentu. Dostawca API, główna możliwość i kontekst mają stałe miejsca w drugim wierszu.

`node scripts/test-model-selector-runtime.mjs` sprawdza panel w działającej aplikacji: wybór klawiaturą, zapis aktywnego i ostatnio używanego modelu, wyszukiwanie, filtry, grupy i zwijanie, oba motywy i okno 900 px. Zapisuje zrzuty oraz `.design-qa/model-picker-results.json`. Dodatkowo 53 testy jednostkowe selektora i blokady konfiguracji sprawdzają zachowanie wyboru, rozumowania, deduplikacji, historii, klasyfikacji rodzin i sortowania modeli.
