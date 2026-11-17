---
title: "Een opgeslagen project als gekoppelde audio hergebruiken"
description: "Plaats een opgeslagen project in een ander arrangement en neem latere wijzigingen over."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"ff1eb7c442461290d4b0b61fc89870619cc8872f4ee2143e65283db0dc1defa9","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"ff1eb7c442461290d4b0b61fc89870619cc8872f4ee2143e65283db0dc1defa9","targetLocale":"nl"} -->

Plaats een opgeslagen project in een ander arrangement en neem latere wijzigingen over.

## Voordat je begint

Sla het onderliggende Soundscaper-project op in dezelfde lokale projectbibliotheek. Rond eerst de mix af. Render actieve native plug-inverwerking en leg deze vast in audio voordat je de achtergrondrenderer voor subprojecten gebruikt.

## Stappen

1. Open het bovenliggende project en kies **Bestand > Subprojects**.
2. Kies het onderliggende project bij **Project to insert or relink** en kies daarna **Insert subproject**. De gepubliceerde mix verschijnt op een nieuwe track.
3. Selecteer de koppeling bij **Linked subprojects** en kies **Open subproject** om het onderliggende project te bewerken. Sla het op en ga terug naar het bovenliggende project om de bijgewerkte audio te beluisteren.
4. Kies **Pin current audio** om deze revisie vast te zetten, of **Make independent audio** om de koppeling met het onderliggende project te verbreken.

## Het resultaat controleren

De plaatsing in het bovenliggende project blijft op dezelfde positie wanneer het onderliggende project wordt bijgewerkt. Speel de audio na het vernieuwen af en controleer het begin en einde. Een kortere mix wordt binnen het oorspronkelijk gepubliceerde bereik met stilte aangevuld.

## Beperkingen en herstel

De gepubliceerde duur en kanaalindeling blijven vast; voeg een nieuwe plaatsing toe voor een ander bereik. Een draagbaar bestand van het bovenliggende project bevat de geïnstalleerde audio, maar niet het bewerkbare onderliggende project. Verplaats dat project afzonderlijk en gebruik **Relink to selected project**. Lussen in koppelingen worden geweigerd.
