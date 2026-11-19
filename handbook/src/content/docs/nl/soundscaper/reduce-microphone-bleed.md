---
title: "Overdracht tussen dialoogmicrofoons verminderen"
description: "Maak bewerkbare volumecurves die samenhangende overdracht op inactieve microfoons zachter zetten."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"5c9e85ea0bae3f0c6489f0b5a3235c11e843612c88fa8c2076a4c00e82937752","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"5c9e85ea0bae3f0c6489f0b5a3235c11e843612c88fa8c2076a4c00e82937752","targetLocale":"nl"} -->

Maak bewerkbare volumecurves die samenhangende overdracht op inactieve microfoons zachter zetten.

## Voordat je begint

Gebruik twee tot acht in de tijd uitgelijnde dialoogtracks, idealiter één microfoon per persoon met vergelijkbare opnameversterking. Selecteer een positief tijdsbereik met audio op elke gekozen track. Ontgrendel de tracks en hef het bevriezen ervan op.

## Stappen

1. Selecteer de microfoontracks en de passage die je wilt verwerken.
2. Open **Effect > Ruisverwijdering en reparatie > Automatic microphone-bleed reduction**.
3. Begin met de standaardinstellingen en kies **Create gain envelopes**.
4. Speel de passage af, vooral onderbrekingen en overlappende spraak. Gebruik **Clip-versterking** om punten aan te passen die gewenste spraak zachter zetten.

## Het resultaat controleren

Volumepunten verminderen overdracht terwijl de oorspronkelijke bronnen en clipposities behouden blijven. Controleer de inzetten van elke spreker en de grenzen van de selectie. Met **Ongedaan maken** maak je de bewerking ongedaan; met **Opnieuw uitvoeren** voer je deze opnieuw uit.

## Beperkingen en herstel

De functie lijnt opnamen niet uit en scheidt geen stemmen binnen een actieve microfoon. Grote verschillen in versterking, galm en zachte spraak onder luide overdracht kunnen fouten veroorzaken. Als je andere instellingen wilt proberen, maak dan de eerste toepassing ongedaan: nogmaals toepassen stapelt de verzwakking op. Spectrale selecties en vergrendelde of bevroren tracks kunnen niet worden verwerkt.
