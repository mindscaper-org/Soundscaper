---
title: "Folosește pluginuri audio pentru desktop"
description: "Găsește, activează și ascultă efecte și instrumente native în Soundscaper desktop."
diataxis: how-to
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"gpt-6-luna","modelProvider":"codex-subagent"},"factPacketSha256":"ee294775a2938f1c35bb03712c6e4d726617fd3351241c60a1e5cfb69c886c18","model":"gpt-6","modelProvider":"codex","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"ee294775a2938f1c35bb03712c6e4d726617fd3351241c60a1e5cfb69c886c18","targetLocale":"ro"} -->

Găsește, activează și ascultă efecte și instrumente native în Soundscaper desktop.

## Înainte de a începe

Instalează o versiune de plugin compatibilă cu sistemul de operare și formatul de host acceptat. Pluginurile desktop incluse sunt disponibile implicit în pachetele acceptate; pluginurile suplimentare trebuie detectate și pot necesita permisiuni.

## Pași

1. Deschide **Efect > Managerul de plugin-uri**. Caută în listă și folosește **Scanare și setări** pentru configurarea detectării.
2. Selectează pluginul și verifică versiunea, permisiunea și comenzile de recuperare. Activează-l când este potrivit.
3. Adaugă un efect prin **Efect > Efecte plugin-uri audio** sau un rack în timp real. Selectează instrumente native din comenzile instrumentului de pe pista MIDI.
4. Ascultă redarea, salvează un preset dacă e util și salvează proiectul.

## Cântă printr-un amplificator de chitară

Adaugă **OrbitAmp** din **Efect > Efecte plugin-uri audio** sau din rackul de efecte în timp real al pistei. Deschide editorul plug-inului și alege un amplificator în secțiunea **AMP** și o incintă acustică în secțiunea **CAB**. Pachetul pentru desktop include sunetele din fabrică.

## Verifică rezultatul

Pluginul dorit ar trebui să proceseze sunetul și să reîncarce setările salvate când este disponibil același binar compatibil. Ocolește-l pentru comparație și verifică exportul înainte de livrare.

## Limite și recuperare

Pachetele Windows acceptă căile de bridging VST2 menținute, inclusiv pluginuri compatibile pe 32 de biți. Linux poate folosi Windows VST3 printr-o configurare yabridge/Wine instalată și configurată; aceasta nu instalează și nu licențiază pluginuri terțe. Preseturile nu includ binarele. Dacă un plugin eșuează, folosește comenzile de recuperare din Plugin Manager și încearcă o versiune compatibilă înainte de a relua lucrul.
