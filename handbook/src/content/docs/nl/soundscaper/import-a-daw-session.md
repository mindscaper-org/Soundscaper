---
title: "Een audiosessie uit een andere editor importeren"
description: "Importeer ondersteunde audiobewerkingen, koppel de media opnieuw en bekijk de conversiebeperkingen."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"20d929f85abefccaba62453f8ca9bca18af93a0fc4a37fda4c3ed0084862cb85","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"20d929f85abefccaba62453f8ca9bca18af93a0fc4a37fda4c3ed0084862cb85","targetLocale":"nl"} -->

Importeer ondersteunde audiobewerkingen, koppel de media opnieuw en bekijk de conversiebeperkingen.

## Voordat je begint

Kopieer de sessie en bijbehorende audio naar een toegankelijke map. Ondersteunde native imports van audiosessies zijn REAPER `.rpp`, Hindenburg `.nhsx`, Pro Tools `.pts`/`.ptf`/`.ptx`, Ardour `.ardour`, SoundCraft-sessies en Audition `.sesx` of de oudere `.ses`. Bewaar het oorspronkelijke project.

## Stappen

1. Kies **Bestand > Geopend** of **Bestand > Importeren**, of sleep de sessie naar de werkruimte.
2. Selecteer in een browser de bijbehorende audio samen met de sessie. Geef op desktop toegang tot de mediamap wanneer daarom wordt gevraagd.
3. Open **Bestand > Leveringsrapport**. Lees wat is weggelaten of geconverteerd en koppel offline media zo nodig opnieuw.
4. Beluister representatieve bewerkingen en fades, controleer trackvolgorde en timing en sla een nieuw Scape-project op.

## Het resultaat controleren

De geïmporteerde knips horen overeen te komen met de toegankelijke bronaudio. Vergelijk het resultaat met een referentiemix uit de oorspronkelijke editor, vooral wanneer verwerking, routering of automatisering van belang is.

## Beperkingen en herstel

Native import zet audiobewerkingen om en garandeert geen identieke mix. Welke details worden ondersteund, verschilt per formaat; plug-ins uit de bronsessie worden niet uitgevoerd. REAPER gebruikt de actieve audiotakes en laat het bewerken van alternatieve takes, MIDI, routering en plug-ins weg. Gebruik voor uitwisseling met een andere DAW ondersteunde uitwisselformaten zoals AES31 ADL of DAWproject in plaats van een native sessie-export te verwachten.
