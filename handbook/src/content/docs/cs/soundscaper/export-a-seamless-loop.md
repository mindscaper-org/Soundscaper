---
title: "Exportovat smyčku včetně dozvuků efektů"
description: "Přeneste dozvuk reverbu nebo zpoždění na začátek opakujícího se zvukového souboru."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"70ee9977385574f17d5b85641f92c402e911407d0a4c2cb62ccbd14f4d1a6e15","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"70ee9977385574f17d5b85641f92c402e911407d0a4c2cb62ccbd14f4d1a6e15","targetLocale":"cs"} -->

Přeneste dozvuk reverbu nebo zpoždění na začátek opakujícího se zvukového souboru.

## Než začnete

Připravte přesný rozsah smyčky s požadovaným zpracováním. Ke kontrole spojení použijte bezeztrátový formát, například WAV. Udržujte úroveň při přehrávání i exportu pod hranicí ořezu.

## Postup

1. Vyberte časový rozsah, který se má opakovat, a otevřete **Soubor > Exportovat zvuk**.
2. Zvolte vybraný rozsah a vhodný formát, vzorkovací frekvenci a rozložení kanálů.
3. V nastavení exportu zapněte **Render as loop** a soubor exportujte.
4. Importujte výsledek do testovacího projektu a poslechněte si několik opakování, zejména na hranici smyčky.

## Kontrola výsledku

Exportovaný soubor zachová zvolenou délku smyčky a vyrenderovaný dozvuk přenese na její začátek. Poslouchejte, zda se neozývá cvaknutí nebo skok hlasitosti a zda reverb plynule navazuje.

## Omezení a obnova

Přenesení dozvuku nenapraví nevhodný hudební střih ani nespojitý suchý průběh vlny. Liší se od volby **Zahrnout dozvuky efektů v délce až 10 sekund**, která prodlužuje běžný export. Součet dozvuků může zvýšit špičky; snižte úroveň nebo použijte volitelné omezení skutečných špiček v Limiteru a dodaný soubor zkontrolujte. Ztrátové formáty mohou přidat výplň nebo změnit špičky, proto ověřte také skutečný cílový formát.
