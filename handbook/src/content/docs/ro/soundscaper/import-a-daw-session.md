---
title: "Importă o sesiune audio din alt editor"
description: "Importă editări audio acceptate, reconectează fișierele media și verifică limitele conversiei."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"20d929f85abefccaba62453f8ca9bca18af93a0fc4a37fda4c3ed0084862cb85","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"20d929f85abefccaba62453f8ca9bca18af93a0fc4a37fda4c3ed0084862cb85","targetLocale":"ro"} -->

Importă editări audio acceptate, reconectează fișierele media și verifică limitele conversiei.

## Înainte de a începe

Copiază sesiunea și audio-ul ei într-un folder accesibil. Importurile native acceptate de sesiuni audio includ REAPER `.rpp`, Hindenburg `.nhsx`, Pro Tools `.pts`/`.ptf`/`.ptx`, Ardour `.ardour`, sesiuni SoundCraft și Audition `.sesx` sau formatul vechi `.ses`. Păstrează proiectul original.

## Pași

1. Alege **Fișier > Deschis** sau **Fișier > Import** ori plasează sesiunea în spațiul de lucru.
2. În browser, selectează audio-ul asociat împreună cu sesiunea. Pe desktop, acordă acces la folderul media când ți se cere.
3. Deschide **Fișier > Raport livrare**. Citește omisiunile și conversiile, apoi reconectează fișierele offline dacă este necesar.
4. Ascultă editări și fade-uri reprezentative, inspectează ordinea și temporizarea pistelor și salvează un proiect Scape nou.

## Verifică rezultatul

Tăieturile importate ar trebui să se alinieze cu audio-ul sursă accesibil. Compară rezultatul cu un mixaj de referință din editorul original, mai ales când contează procesarea, rutarea sau automatizarea.

## Limite și recuperare

Importul nativ convertește editări audio și nu promite mixaje identice. Detaliile acceptate diferă în funcție de format; pluginurile din sesiunea sursă nu sunt executate. REAPER folosește take-urile audio active și omite editarea take-urilor alternative, MIDI, rutarea și pluginurile. Pentru schimb cu alt DAW, folosește formate de interoperabilitate acceptate, precum AES31 ADL sau DAWproject, nu te aștepta să poți scrie o sesiune nativă.
