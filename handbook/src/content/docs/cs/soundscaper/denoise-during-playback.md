---
title: "Omezit šum během přehrávání"
description: "Přidejte na dialogovou stopu efekt AI pro odstranění šumu v reálném čase."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"48233da1a6a6383c3a32842c992910b81829a02ec6bf2017024cbda63dfe01d6","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"48233da1a6a6383c3a32842c992910b81829a02ec6bf2017024cbda63dfe01d6","targetLocale":"cs"} -->

Přidejte na dialogovou stopu efekt AI pro odstranění šumu v reálném čase.

## Než začnete

Použijte Soundscaper pro desktop. Otevřete **Nástroje > Správce modelů** a nainstalujte odpovídající model pro odstranění šumu v reálném čase a běhové prostředí, které nabízí vaše sestavení aplikace. Instalace modelu znamená výslovné stažení; samotný prohlížeč tento nativní efekt nespustí.

## Postup

1. Vyberte zašuměnou dialogovou stopu a otevřete její řetězec efektů v reálném čase.
2. Zvolte **Přidat efekt** a vyberte **AI denoising (DPDFNet2)**.
3. Spusťte přehrávání a pomocí vypínače efektu porovnejte zvuk s vypnutým zpracováním.
4. Upravte mix kolem vyčištěné stopy a před odevzdáním si poslechněte export. Projekt uložte, aby se řetězec zachoval.

## Kontrola výsledku

Šum by měl zeslábnout a řeč zůstat srozumitelná. Zkontrolujte tiché souhlásky, nádechy a začátek přehrávání. Pokud zvuk kolísá nebo se ztrácí řeč, efekt vypněte a porovnejte jej s originálem.

## Omezení a obnova

Jde o odstranění šumu z řeči, ne o obecný efekt pro obnovu hudby. Přehrávání na jiném počítači vyžaduje kompatibilní model i nativní běhové prostředí. Pokud efekt není dostupný, ověřte instalaci a podporu desktopové verze; pro zkontrolovaný vyrenderovaný výsledek použijte [offline obnovu řeči](/soundscaper/restore-damaged-speech/). Stažení modelu nezaručuje zlepšení každé nahrávky.
