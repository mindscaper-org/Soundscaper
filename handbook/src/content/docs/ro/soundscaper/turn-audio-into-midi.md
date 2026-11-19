---
title: "Transformă notele înregistrate în MIDI editabil"
description: "Analizează o înregistrare muzicală cu Basic Pitch și păstrează note editabile lângă audio."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"181c19e5cd65ab9072edb6fd6211bd2006656197182553009771a0e0f4262552","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"181c19e5cd65ab9072edb6fd6211bd2006656197182553009771a0e0f4262552","targetLocale":"ro"} -->

Analizează o înregistrare muzicală cu Basic Pitch și păstrează note editabile lângă audio.

## Înainte de a începe

Folosește Soundscaper desktop cu modelul Basic Pitch publicat și runtime-ul corespunzător instalat. Începe cu o selecție muzicală scurtă, cu înălțimi clare. Păstrează audio-ul ca referință auditivă.

## Pași

1. Selectează audio-ul muzical și deschide **Instrumente > Procesare locală avansată**.
2. Setează **Operațiune** la **Audio to MIDI (Basic Pitch)**. Confirmă consimțământul necesar pentru procesare locală și alege **Analizează**.
3. Alege **Revizuiește rezultatul**, inspectează notele detectate și selectează **Acceptă propunerea** când ești gata.
4. Deschide **Fereastră > Piano roll (beta)**, selectează noul material MIDI și corectează înălțimile, temporizarea și duratele notelor.

## Verifică rezultatul

Apare o pistă MIDI nouă lângă audio-ul original. Alege un instrument și ascultă-l împreună cu înregistrarea. **Revenire** elimină propunerea acceptată fără a șterge audio-ul sursă.

## Limite și recuperare

Notele detectate sunt estimări, mai ales în mixaje dense sau înregistrări zgomotoase. MIDI surprinde notele, nu timbrul original. Folosește [instrumentele MIDI](/soundscaper/play-midi-instruments/) pentru redare și **Fișier > Export alte formate > Export MIDI (beta)** pentru a partaja notele. Destinatarii au nevoie în continuare de un instrument care să poată reproduce sunetul intenționat.
