---
title: "Přehrávat MIDI přes nástroj"
description: "Zvolte syntezátor pro MIDI noty a zachovejte upravitelný hudební výkon."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"a602eb1b31f25ec991fc89a9dcdeefe620afcc71915c03f0a6860b87c9efc542","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"a602eb1b31f25ec991fc89a9dcdeefe620afcc71915c03f0a6860b87c9efc542","targetLocale":"cs"} -->

Zvolte syntezátor pro MIDI noty a zachovejte upravitelný hudební výkon.

## Než začnete

Otevřete nebo importujte MIDI, případně v aplikaci Soundscaper vytvořte novou stopu. Integrované možnosti přehrávání se liší podle volitelných nativních nástrojů. Nativní plug-inové nástroje vyžadují desktopovou aplikaci a zapnutý odpovídající plug-in.

## Postup

1. Potřebujete-li stopu, zvolte **Stopy > Přidat novou stopu > MIDI track (beta)**.
2. Otevřete **Okno > Piano roll (beta)**. Přidejte noty nebo vyberte existující MIDI materiál.
3. Zvolte **Instrument**. Chcete-li upravit zvuk nativního nástroje a uložit jeho předvolbu, otevřete **Instrument settings**.
4. Spusťte přehrávání, zkontrolujte noty i doznívání, uložte projekt a znovu jej otevřete.

## Kontrola výsledku

Měli byste slyšet zvolený nástroj, přičemž noty zůstanou upravitelné v klavírním editoru. Nastavení a předvolby nástroje se po opětovném otevření obnoví, pokud je potřebný plug-in nainstalován.

## Omezení a obnova

Nativní nástroje jsou dostupné na MIDI stopách, nikoli na běžných zvukových stopách. Uložená předvolba nezahrnuje binární soubor plug-inu ani jeho externí knihovny. Přibalené nástroje jsou ve podporovaných desktopových balíčcích zapnuté ve výchozím stavu; jiné mohou vyžadovat [Správce plug-inů](/soundscaper/use-desktop-plugins/). Než se spolehnete na stejnou barvu zvuku, ověřte přehrávání i export na cílovém počítači.
