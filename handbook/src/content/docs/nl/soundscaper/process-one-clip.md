---
title: "Realtime-effecten op één clip toepassen"
description: "Geef één audioclip een eigen effectenrek zonder alle clips op de track te verwerken."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"0d37cd5c96e28ec54b0e1f2cb991c996e77e1e10a9b8583b806ac616d53a87f2","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"0d37cd5c96e28ec54b0e1f2cb991c996e77e1e10a9b8583b806ac616d53a87f2","targetLocale":"nl"} -->

Geef één audioclip een eigen effectenrek zonder alle clips op de track te verwerken.

## Voordat je begint

Selecteer een audioclip in Soundscaper. Clip-effecten maken deel uit van de verwerking van die clip en worden doorgegeven aan de trackeffecten; verwerking op track- en masterniveau kan nog steeds veranderen wat je hoort.

## Stappen

1. Open **Venster > Clipeigenschappen** en klap **Effecten** uit. Dit is het effectenrek van de clip.
2. Kies **Effect toevoegen**, selecteer een effect en pas de instellingen aan. Speel de clip af om het te beluisteren.
3. Gebruik de aan-uitknop van het effect om het geluid met en zonder verwerking te vergelijken. Wijzig zo nodig de volgorde of verwijder effecten uit het rek.
4. Sla het project op en beluister de clip samen met de omliggende clips. Gebruik **Ongedaan maken** als de wijziging niet helpt.

## Het resultaat controleren

De gekozen clip heeft een eigen verwerking en andere clips behouden hun eigen instellingen. Luister voorbij het einde voor een galm- of delaystaart. Controleer het effectenrek van de track als het gecombineerde resultaat te sterk is.

## Beperkingen en herstel

Een effectstaart kan langer duren dan de bronaudio van de clip; controleer vóór oplevering de opties voor exportstaarten. Kies voor een Auto Duck-detector een andere geschikte track; terugkoppellussen worden geweigerd. Open **Meer opties > Auto-idle** in de effectkop om in te stellen of de processor tijdens stilte slaapt. Schakel dit uit voor timinggevoelige plug-ins. Zie [lokale verwerking](/help/local-processing/) voor verwante instellingen.
