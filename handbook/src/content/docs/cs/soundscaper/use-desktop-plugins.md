---
title: "Používat desktopové zvukové plug-iny"
description: "Vyhledejte, povolte a poslechněte si nativní efekty a nástroje v Soundscaperu pro desktop."
diataxis: how-to
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"gpt-6-luna","modelProvider":"codex-subagent"},"factPacketSha256":"ee294775a2938f1c35bb03712c6e4d726617fd3351241c60a1e5cfb69c886c18","model":"gpt-6","modelProvider":"codex","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"ee294775a2938f1c35bb03712c6e4d726617fd3351241c60a1e5cfb69c886c18","targetLocale":"cs"} -->

Vyhledejte, povolte a poslechněte si nativní efekty a nástroje v Soundscaperu pro desktop.

## Než začnete

Nainstalujte sestavení plug-inu kompatibilní s vaším operačním systémem a podporovaným formátem hostitele. Plug-iny přibalené v desktopové aplikaci jsou ve podporovaných balíčcích ve výchozím nastavení dostupné; další plug-iny je třeba vyhledat a udělit jim případná oprávnění.

## Postup

1. Otevřete **Efekt > Správa pluginů**. Plug-in vyhledejte v seznamu a pomocí **Skenování a nastavení** upravte možnosti hledání.
2. Vyberte plug-in a zkontrolujte jeho verzi, oprávnění a ovládací prvky obnovy. Podle potřeby jej povolte.
3. Přidejte efekt přes **Efekt > Audio pluginy** nebo řetězec efektů v reálném čase. Nativní nástroje vyberte v ovládání nástroje MIDI stopy.
4. Poslechněte si přehrávání, případně uložte předvolbu a uložte projekt.

## Hra přes kytarový zesilovač

Přidejte **OrbitAmp** z nabídky **Efekt > Audio pluginy** nebo ze stojanu efektů stopy v reálném čase. Otevřete editor zásuvného modulu, v části **AMP** vyberte zesilovač a v části **CAB** reprobox. Balíček pro stolní počítače obsahuje tovární zvuky.

## Kontrola výsledku

Požadovaný plug-in by měl zpracovávat zvuk a po opětovném načtení obnovit uložené nastavení, pokud je k dispozici tentýž kompatibilní binární soubor. Vypnutím jej porovnejte a před odevzdáním zkontrolujte export.

## Omezení a obnova

Balíčky pro Windows podporují udržované cesty k VST2 bridge včetně podporovaných 32bitových plug-inů. V Linuxu lze použít Windows VST3 přes nainstalované a nakonfigurované yabridge/Wine; tím se pro vás plug-iny třetích stran nenainstalují ani nezískají licenci. Předvolby plug-inu nezahrnují jeho binární soubory. Pokud plug-in selže, použijte ovládání obnovy ve Správci plug-inů a před pokračováním vyzkoušejte kompatibilní verzi.
