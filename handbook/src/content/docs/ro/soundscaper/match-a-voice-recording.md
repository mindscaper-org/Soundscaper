---
title: "Potrivește tonalitatea unei înregistrări vocale"
description: "Învață o referință tonală și folosește Match EQ pentru a apropia de ea altă înregistrare."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"2b6667d165ad26e0b7420dc98e595da9045ad4ca45fdda417a37a2d3e697c0e4","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"2b6667d165ad26e0b7420dc98e595da9045ad4ca45fdda417a37a2d3e697c0e4","targetLocale":"ro"} -->

Învață o referință tonală și folosește Match EQ pentru a apropia de ea altă înregistrare.

## Înainte de a începe

Alege o referință audibilă cu gamă completă de frecvență, de cel puțin un sfert de secundă, de preferat cu același vorbitor înregistrat bine. Pregătește înregistrarea țintă. Funcția folosește procesare locală atât în browser, cât și pe desktop.

## Pași

1. Selectează referința și deschide **Efect > Egalizator și filtre > Match EQ**. Alege **Learn reference from selection**.
2. Salvează referința învățată ca preset dacă vrei să refolosești profilul vocal. Închide caseta de dialog.
3. Selectează ținta, redeschide Match EQ, reapelează referința dacă este nevoie și alege **Analyze target**.
4. Folosește **Previzualizare** pentru a compara **Original** și **Matched (level compensated)**. Ajustează corecția, apoi alege **Aplicați pe selecție** sau **Edit as Filter Curve EQ** pentru a edita curba.

## Verifică rezultatul

Ascultă la o intensitate similară pentru o comparație tonală mai bună. Audio-ul procesat își păstrează durata și numărul de canale. **Revenire** anulează aplicarea.

## Limite și recuperare

Match EQ nu poate reface lățimea de bandă pierdută și nu potrivește interpretarea, dinamica, reverberația camerei sau identitatea vocii. Captarea referinței include efectele pistei dinaintea busurilor și masterului; ținta este analizată înaintea rackului pistei. Randează mai întâi o referință când sunetul dorit depinde de procesarea ulterioară.
