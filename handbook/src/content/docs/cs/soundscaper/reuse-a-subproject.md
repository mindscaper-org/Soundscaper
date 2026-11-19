---
title: "Znovu použít uložený projekt jako propojený zvuk"
description: "Vložte uložený projekt do jiného aranžmá a přebírejte jeho pozdější úpravy."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"ff1eb7c442461290d4b0b61fc89870619cc8872f4ee2143e65283db0dc1defa9","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"ff1eb7c442461290d4b0b61fc89870619cc8872f4ee2143e65283db0dc1defa9","targetLocale":"cs"} -->

Vložte uložený projekt do jiného aranžmá a přebírejte jeho pozdější úpravy.

## Než začnete

Podřízený projekt Soundscaper uložte do stejné místní knihovny projektů. Nejprve dokončete mix. Aktivní zpracování nativním plug-inem vyrenderujte a potvrďte do zvuku, než použijete renderer podprojektu na pozadí.

## Postup

1. Otevřete nadřazený projekt a zvolte **Soubor > Subprojects**.
2. V části **Project to insert or relink** vyberte podřízený projekt a zvolte **Insert subproject**. Jeho zveřejněný mix se objeví na nové stopě.
3. V části **Linked subprojects** vyberte odkaz a zvolte **Open subproject**, abyste upravili podřízený projekt. Uložte ho a vraťte se do nadřazeného projektu, kde si poslechnete aktualizovaný zvuk.
4. Zvolte **Pin current audio**, chcete-li tuto verzi zachovat, nebo **Make independent audio**, pokud už se nemá řídit podřízeným projektem.

## Kontrola výsledku

Umístění v nadřazeném projektu zůstane při aktualizaci podřízeného projektu stejné. Po aktualizaci přehrání zkontrolujte na začátku i na konci. Kratší mix podřízeného projektu je v rozsahu původní zveřejněné délky doplněn tichem.

## Omezení a obnova

Zveřejněná délka a rozložení kanálů zůstávají pevné; pro jiný rozsah vložte další umístění. Přenosný soubor nadřazeného projektu obsahuje vložený zvuk, nikoli upravitelný podřízený projekt. Ten přeneste samostatně a použijte **Relink to selected project**. Cyklus propojení není povolen.
