---
title: "Sladit zvuk hlasové nahrávky"
description: "Naučte se tónovou referenci a pomocí Match EQ ji přibližte jiné nahrávce."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"2b6667d165ad26e0b7420dc98e595da9045ad4ca45fdda417a37a2d3e697c0e4","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"2b6667d165ad26e0b7420dc98e595da9045ad4ca45fdda417a37a2d3e697c0e4","targetLocale":"cs"} -->

Naučte se tónovou referenci a pomocí Match EQ ji přibližte jiné nahrávce.

## Než začnete

Vyberte slyšitelnou referenci s plnou šířkou pásma, dlouhou alespoň čtvrt sekundy, nejlépe se stejným mluvčím nahraným v dobrých podmínkách. Připravte cílovou nahrávku. Funkce používá místní zpracování v prohlížeči i desktopové aplikaci.

## Postup

1. Vyberte referenci a otevřete **Efekt > Ekvalizace a filtry > Match EQ**. Zvolte **Learn reference from selection**.
2. Chcete-li hlasový profil používat znovu, uložte naučenou referenci jako předvolbu. Zavřete dialog.
3. Vyberte cílový záznam, znovu otevřete Match EQ, případně vyvolejte referenci a zvolte **Analyze target**.
4. Pomocí **Původní** porovnejte **Matched (level compensated)** a **Náhled**. Upravte korekci a zvolte **Použít na výběr**, případně **Edit as Filter Curve EQ** a dolaďte křivku.

## Kontrola výsledku

Při podobné hlasitosti posuďte, zda je tónová rovnováha bližší. Upravený zvuk zachová délku i počet kanálů. **Zpět** použití efektu vrátí.

## Omezení a obnova

Match EQ nedoplní chybějící šířku pásma ani nesladí přednes, dynamiku, dozvuk místnosti nebo identitu hlasu. Zachycení reference zahrnuje efekty stopy před sběrnicemi a hlavním výstupem; cíl se analyzuje před efektovým řetězcem stopy. Závisí-li požadovaný zvuk na dalším zpracování, nejprve referenci vyrenderujte.
