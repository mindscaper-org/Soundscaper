---
title: "Importovat zvukovou relaci z jiného editoru"
description: "Importujte podporované zvukové úpravy, znovu připojte jejich média a projděte omezení převodu."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"20d929f85abefccaba62453f8ca9bca18af93a0fc4a37fda4c3ed0084862cb85","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"20d929f85abefccaba62453f8ca9bca18af93a0fc4a37fda4c3ed0084862cb85","targetLocale":"cs"} -->

Importujte podporované zvukové úpravy, znovu připojte jejich média a projděte omezení převodu.

## Než začnete

Zkopírujte relaci a její zvukové soubory do přístupné složky. Podporované nativní importy zvukových relací zahrnují REAPER `.rpp`, Hindenburg `.nhsx`, Pro Tools `.pts`/`.ptf`/`.ptx`, Ardour `.ardour`, relace SoundCraft a Audition `.sesx` nebo starší `.ses`. Původní projekt si ponechte.

## Postup

1. Zvolte **Soubor > Otevřít** nebo **Soubor > Importovat**, případně přetáhněte relaci do pracovního prostoru.
2. V prohlížeči vyberte související zvukové soubory společně s relací. Desktopové aplikaci při zobrazení výzvy povolte přístup ke složce médií.
3. Otevřete **Soubor > Zpráva o doručení**. Přečtěte si o vynechaných a převedených údajích a podle potřeby znovu propojte nedostupná média.
4. Poslechněte si reprezentativní střihy a prolínačky, zkontrolujte pořadí a načasování stop a uložte nový projekt Scape.

## Kontrola výsledku

Importované střihy mají odpovídat dostupným zdrojovým zvukům. Výsledek porovnejte s referenčním mixem z původního editoru, zejména tam, kde záleží na zpracování, směrování nebo automatizaci.

## Omezení a obnova

Nativní import převádí zvukové úpravy a nezaručuje totožný mix. Podporované podrobnosti závisí na formátu; plug-iny ze zdrojové relace se nespouštějí. REAPER používá aktivní zvukové záběry a vynechává tvorbu alternativních záběrů, MIDI, směrování a plug-iny. Pro výměnu s jinou DAW použijte podporované výměnné formáty, například AES31 ADL nebo DAWproject, a neočekávejte export nativní relace.
