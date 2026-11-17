---
title: "Omezit přeslech mezi dialogovými mikrofony"
description: "Vytvářejte upravitelné obálky zesílení, které ztlumí korelovaný přeslech na neaktivních mikrofonech."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"5c9e85ea0bae3f0c6489f0b5a3235c11e843612c88fa8c2076a4c00e82937752","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"5c9e85ea0bae3f0c6489f0b5a3235c11e843612c88fa8c2076a4c00e82937752","targetLocale":"cs"} -->

Vytvářejte upravitelné obálky zesílení, které ztlumí korelovaný přeslech na neaktivních mikrofonech.

## Než začnete

Použijte dvě až osm časově zarovnaných dialogových stop, ideálně jeden mikrofon na osobu a se srovnatelným záznamovým zesílením. Vyberte kladný časový rozsah se zvukem na všech zvolených stopách. Stopy odemkněte a zrušte jejich zmrazení.

## Postup

1. Vyberte mikrofonní stopy a pasáž, kterou chcete zpracovat.
2. Otevřete **Efekt > Odstranění šumu a oprava > Automatic microphone-bleed reduction**.
3. Začněte s výchozím nastavením a zvolte **Create gain envelopes**.
4. Přehrajte pasáž, zejména přerušení a překrývající se řeč. Pomocí **Zesílení klipu** upravte vygenerované body, které ztlumily žádoucí řeč.

## Kontrola výsledku

Body zesílení omezí přeslech, zatímco původní zdroje a umístění klipů zůstanou dostupné. Zkontrolujte nástupy jednotlivých mluvčích i hranice výběru. **Zpět** operaci odebere a **Znovu** ji opět provede.

## Omezení a obnova

Funkce nezarovnává nahrávky ani neodděluje hlasy zachycené aktivním mikrofonem. Výrazně rozdílné zesílení, dozvuk a tichá řeč pod hlasitým přeslechem mohou způsobit chyby. Chcete-li zkusit jiné nastavení, nejprve první použití vraťte zpět; opakované použití by zeslabení sčítalo. Zpracovat nelze spektrální výběry ani zamčené či zmrazené stopy.
