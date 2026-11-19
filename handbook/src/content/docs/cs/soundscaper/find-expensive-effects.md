---
title: "Najít efekty náročné na CPU při přehrávání"
description: "Porovnejte náklady efektů v reálném čase, než se rozhodnete zjednodušit zpracování."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"06fac5e13d2af31e85494e4a5e5b9fa26ae67584fd3365c795c95d63d93a255d","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"06fac5e13d2af31e85494e4a5e5b9fa26ae67584fd3365c795c95d63d93a255d","targetLocale":"cs"} -->

Porovnejte náklady efektů v reálném čase, než se rozhodnete zjednodušit zpracování.

## Než začnete

Použijte projekt s efekty v reálném čase a reprezentativní náročnou pasáží. Měření popisuje tento počítač a pracovní zátěž; nejde o univerzální pořadí plug-inů podle náročnosti.

## Postup

1. Otevřete **Nápověda > CPU profiling**.
2. Po otevření panelu spusťte nebo znovu spusťte přehrávání, aby bylo možné změřit každý efekt v reálném čase.
3. Sledujte několik aktualizací. Porovnejte řádky efektů se základním řádkem editoru, vypněte jeden náročný efekt a zopakujte přehrání stejné pasáže.
4. Po dokončení panel zavřete a obnovte zpracování, které chcete zachovat.

## Kontrola výsledku

Využití CPU může překročit kapacitu jednoho jádra: 100 % znamená plně vytížené jedno jádro procesoru. Porovnejte procenta využití CPU a uplynulé doby zpracování. Pomlčka znamená, že měření není dostupné, nikoli nulové náklady.

## Omezení a obnova

Uplynulá doba zpracování zahrnuje prodlevy plánování. Využití GPU a externí pomocné procesy se nezapočítávají; profilování navíc samo přidává režii. Vypnutý efekt je označen zvlášť. V záhlaví efektu otevřete **Další možnosti > Auto-idle**, aby vhodný procesor mohl během ticha přejít do úsporného režimu. U efektů, které vyžadují plynulé časování, tuto funkci vypněte. Další související nastavení najdete v části [Místní zpracování](/help/local-processing/). Při porovnávání změn vždy znovu přehrajte stejnou pasáž.
