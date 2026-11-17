---
title: "Použít efekty v reálném čase na jeden klip"
description: "Přiřaďte jednomu zvukovému klipu vlastní efektový řetězec, aniž byste zpracovali všechny klipy na jeho stopě."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"0d37cd5c96e28ec54b0e1f2cb991c996e77e1e10a9b8583b806ac616d53a87f2","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"0d37cd5c96e28ec54b0e1f2cb991c996e77e1e10a9b8583b806ac616d53a87f2","targetLocale":"cs"} -->

Přiřaďte jednomu zvukovému klipu vlastní efektový řetězec, aniž byste zpracovali všechny klipy na jeho stopě.

## Než začnete

V aplikaci Soundscaper vyberte zvukový klip. Efekty klipu jsou součástí jeho zpracování a předávají zvuk efektům stopy; zpracování stopy a hlavního výstupu může stále měnit, co slyšíte.

## Postup

1. Otevřete **Okno > Vlastnosti klipu** a rozbalte **Efekty**. Jde o efektový řetězec tohoto klipu.
2. Zvolte **Přidat efekt**, vyberte efekt a upravte jeho nastavení. Přehráním klipu si výsledek poslechněte.
3. Tlačítkem napájení efektu porovnejte zpracovaný zvuk s vypnutým efektem. Podle potřeby změňte pořadí efektů nebo je z řetězce odeberte.
4. Uložte projekt a poslechněte si klip spolu se sousedními klipy. Pokud změna nepomáhá, použijte **Zpět**.

## Kontrola výsledku

Vybraný klip má vlastní zpracování, ostatní klipy si zachovávají svá nastavení. Poslechněte si také dozvuk za koncem klipu a při příliš výrazném výsledku zkontrolujte efektový řetězec stopy.

## Omezení a obnova

Dozvuk efektu může přesáhnout zdrojový zvuk klipu; před odevzdáním zkontrolujte možnosti dozvuku při exportu. Pro detektor Auto Duck vyberte jinou vhodnou stopu; zpětnovazební smyčky se odmítají. V záhlaví efektu otevřete **Další možnosti > Auto-idle** a nastavte uspávání během ticha. U plug-inů citlivých na časování tuto funkci vypněte. Další související nastavení najdete v části [Místní zpracování](/help/local-processing/).
