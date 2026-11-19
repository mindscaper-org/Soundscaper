---
title: "Převést nahrané tóny na upravitelné MIDI"
description: "Analyzujte hudební nahrávku pomocí Basic Pitch a ponechte upravitelné noty vedle zvuku."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"181c19e5cd65ab9072edb6fd6211bd2006656197182553009771a0e0f4262552","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"181c19e5cd65ab9072edb6fd6211bd2006656197182553009771a0e0f4262552","targetLocale":"cs"} -->

Analyzujte hudební nahrávku pomocí Basic Pitch a ponechte upravitelné noty vedle zvuku.

## Než začnete

Použijte Soundscaper pro desktop s nainstalovaným zveřejněným modelem Basic Pitch a odpovídajícím běhovým prostředím. Začněte krátkým hudebním výběrem s jasně určenými výškami tónů. Zvuk si ponechte jako poslechovou referenci.

## Postup

1. Vyberte hudební zvuk a otevřete **Nástroje > Pokročilé místní zpracování**.
2. Nastavte **Operace** na **Audio to MIDI (Basic Pitch)**. Potvrďte případný požadovaný souhlas s místním zpracováním a zvolte **Analýza**.
3. Zvolte **Zkontrolovat výsledek**, prohlédněte nalezené noty a až budete připraveni, vyberte **Přijmout návrh**.
4. Otevřete **Okno > Piano roll (beta)**, vyberte nový MIDI materiál a opravte výšku, načasování a délku not.

## Kontrola výsledku

Vedle původního zvuku se objeví nová MIDI stopa. Zvolte nástroj a poslechněte si jej společně s nahrávkou. **Zpět** odstraní přijatý návrh, ale zdrojový zvuk nesmaže.

## Omezení a obnova

Rozpoznané noty jsou odhady, zvláště v hustém mixu nebo zašuměné nahrávce. MIDI zachycuje noty, nikoli původní barvu zvuku. Pro přehrávání použijte [nástroje MIDI](/soundscaper/play-midi-instruments/) a pro sdílení not **Soubor > Exportovat jiné > Export MIDI (beta)**. Příjemci stále potřebují nástroj, který dokáže zamýšlený zvuk reprodukovat.
