---
title: "Folosește pluginuri audio pentru desktop"
description: "Găsește, activează și ascultă efecte și instrumente native în Soundscaper desktop."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"fc4f375d65049fb921bb3c7a04239407a33132340a7eb14cd5eae22db3092c9e","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"fc4f375d65049fb921bb3c7a04239407a33132340a7eb14cd5eae22db3092c9e","targetLocale":"ro"} -->

Găsește, activează și ascultă efecte și instrumente native în Soundscaper desktop.

## Înainte de a începe

Instalează o versiune de plugin compatibilă cu sistemul de operare și formatul de host acceptat. Pluginurile desktop incluse sunt disponibile implicit în pachetele acceptate; pluginurile suplimentare trebuie detectate și pot necesita permisiuni.

## Pași

1. Deschide **Efect > Managerul de plugin-uri**. Caută în listă și folosește **Scanare și setări** pentru configurarea detectării.
2. Selectează pluginul și verifică versiunea, permisiunea și comenzile de recuperare. Activează-l când este potrivit.
3. Adaugă un efect prin **Efect > Efecte plugin-uri audio** sau un rack în timp real. Selectează instrumente native din comenzile instrumentului de pe pista MIDI.
4. Ascultă redarea, salvează un preset dacă e util și salvează proiectul.

## Verifică rezultatul

Pluginul dorit ar trebui să proceseze sunetul și să reîncarce setările salvate când este disponibil același binar compatibil. Ocolește-l pentru comparație și verifică exportul înainte de livrare.

## Limite și recuperare

Pachetele Windows acceptă căile de bridging VST2 menținute, inclusiv pluginuri compatibile pe 32 de biți. Linux poate folosi Windows VST3 printr-o configurare yabridge/Wine instalată și configurată; aceasta nu instalează și nu licențiază pluginuri terțe. Preseturile nu includ binarele. Dacă un plugin eșuează, folosește comenzile de recuperare din Plugin Manager și încearcă o versiune compatibilă înainte de a relua lucrul.
