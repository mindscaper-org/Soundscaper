---
title: "Effecten vinden die CPU-belasting veroorzaken"
description: "Vergelijk de kosten van realtime-effecten voordat je besluit welke verwerking eenvoudiger kan."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"06fac5e13d2af31e85494e4a5e5b9fa26ae67584fd3365c795c95d63d93a255d","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"06fac5e13d2af31e85494e4a5e5b9fa26ae67584fd3365c795c95d63d93a255d","targetLocale":"nl"} -->

Vergelijk de kosten van realtime-effecten voordat je besluit welke verwerking eenvoudiger kan.

## Voordat je begint

Gebruik een project met realtime-effecten en een representatief druk gedeelte. De metingen gelden voor dit apparaat en deze belasting; ze vormen geen universele ranglijst van plug-ins.

## Stappen

1. Open **Help > CPU profiling**.
2. Start het afspelen opnieuw of begin ermee nadat je het paneel hebt geopend, zodat elk realtime-effect kan worden gemeten.
3. Bekijk meerdere updates. Vergelijk de effectregels met de regel voor de basiseditor; schakel een zwaar effect uit en speel hetzelfde gedeelte opnieuw af.
4. Sluit het paneel wanneer je klaar bent en herstel de verwerking die je wilt behouden.

## Het resultaat controleren

Het CPU-gebruik kan de capaciteit van één kern overschrijden: 100% staat voor één volledig bezette CPU-kern. Vergelijk de percentages voor CPU en verstreken verwerkingstijd. Een streepje betekent dat er geen meting beschikbaar is, niet dat het effect niets kost.

## Beperkingen en herstel

De verstreken verwerkingstijd omvat planningsvertragingen. GPU-gebruik en externe hulp processen zijn uitgesloten; profileren zelf voegt ook belasting toe. Een uitgeschakeld effect wordt afzonderlijk aangeduid. Open **Meer opties > Auto-idle** in een effectkop zodat een geschikte processor tijdens stilte kan slapen. Schakel dit uit voor effecten die een doorlopende timing nodig hebben. Zie [lokale verwerking](/help/local-processing/) voor verwante instellingen. Speel bij vergelijkingen steeds dezelfde passage af.
