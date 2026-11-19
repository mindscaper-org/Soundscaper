---
title: "Vyrenderovat program ADM pro reproduktory"
description: "Exportujte vytvořené zvukové kanály a objekty v ADM jako běžný zvuk pro reproduktory pomocí EBU EAR."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"5af5c8eeeac85ba578ac51c27f066d77851b7c1a9128257d3b919b71a1c76825","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"5af5c8eeeac85ba578ac51c27f066d77851b7c1a9128257d3b919b71a1c76825","targetLocale":"cs"} -->

Exportujte vytvořené zvukové kanály a objekty v ADM jako běžný zvuk pro reproduktory pomocí EBU EAR.

## Než začnete

Vytvořte program ADM na kartě ADM v editoru metadat, přiřaďte kanály bed a umístěte objekty. Určete cílové rozložení reproduktorů a zvolte kontejner a kodek podporující potřebný počet kanálů.

## Postup

1. Otevřete **Soubor > Exportovat zvuk**.
2. V části **Vykreslování > EBU EAR speaker rendering** zvolte rozložení: stereo, 5.1, 5.1.2, 5.1.4, 7.1 nebo 7.1.4.
3. Zkontrolujte výstupní formát, počet kanálů a úrovně a poté exportujte.
4. Přečtěte si zprávu o předání a poslechněte si exportovaný soubor přes odpovídající rozložení reproduktorů.

## Kontrola výsledku

Výstup obsahuje vyrenderované PCM pro reproduktory v deklarovaném pořadí kanálů. Tato volba exportu nemění poslech projektu ani původní vytváření ADM. Ve zprávě zkontrolujte použitý renderer a rozložení.

## Omezení a obnova

Vykreslování reproduktorů EAR nelze kombinovat s vykreslováním do sluchátek. Tuto možnost nelze použít pro oddělené výstupy ani přímé předání BW64/ADM. Vyrenderované kanály neobsahují původní metadata ADM pro bed/object; pro tuto výměnu použijte nevyrenderované BW64. Pohyblivé či rozptýlené objekty, HOA, správa basů a certifikované vykreslování Dolby nejsou součástí této funkce. Běžný měřič hlasitosti podporuje nejvýše osm výstupních kanálů.
