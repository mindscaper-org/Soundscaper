---
title: "Zkoumat zvuk během přehrávání"
description: "Pomocí panelu Analýza sledujte živé spektrum, hlasitost a stereo a vytvořte zvukovou zprávu ACX."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"85b26bbd1bc97b708c3e8e62ddfc80986c24be6c078c7c997c569f88fd918643","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"85b26bbd1bc97b708c3e8e62ddfc80986c24be6c078c7c997c569f88fd918643","targetLocale":"cs"} -->

Pomocí panelu Analýza sledujte živé spektrum, hlasitost a stereo a vytvořte zvukovou zprávu ACX.

## Než začnete

Otevřete projekt se zvukem. Rozhodněte, zda chcete zkoumat přehrávání, nebo vybraný rozsah: časový výběr může přepnout spektrum na analýzu vybraného úseku.

## Postup

1. Otevřete **Analyzovat > Analýza**. Rozbalte potřebné části, například **Spectrum**, spektrogram, hlasitost nebo korelaci.
2. Zrušte časový výběr a spusťte přehrávání pro živý náhled. Porovnávejte překryvy stop ve spektru a hledejte konkurenční frekvenční pásma.
3. Zastavte přehrávání a vyberte pasáž, jejíž spektrum chcete zkontrolovat bez přehrávání.
4. Pro kontrolu audioknih rozbalte **ACX compliance** a zvolte **Check audio**. Přečtěte si tabulku výsledků; pomocí **Uložit jako** vytvoříte zprávu JSON.

## Kontrola výsledku

Živé indikátory reagují na přehrávání. Zpráva ACX uvádí u zvukových kontrol splněno nebo nesplněno, nejen hodnotu měřiče. Opravte nevyhovující úrovně či formát a kontrolu zopakujte.

## Omezení a obnova

Spektrum ukazuje energii, nikoli kvalitu mixu. Korelace a hlasitost je třeba posuzovat v kontextu a poslechem. Zvukové kontroly ACX nezaručují přijetí vydavatelskou službou ani nekontrolují všechny redakční požadavky. Sbalením části ACX se zobrazená kontrola vymaže; podle potřeby ji spusťte znovu. Nepotřebné části analyzátoru zavřete, aby se snížila zátěž při zobrazování.
