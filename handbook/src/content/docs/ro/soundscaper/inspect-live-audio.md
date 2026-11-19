---
title: "Inspectează sunetul în timpul redării"
description: "Folosește panoul Analysis pentru spectrul live, intensitate, verificări stereo și un raport audio ACX."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"85b26bbd1bc97b708c3e8e62ddfc80986c24be6c078c7c997c569f88fd918643","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"85b26bbd1bc97b708c3e8e62ddfc80986c24be6c078c7c997c569f88fd918643","targetLocale":"ro"} -->

Folosește panoul Analysis pentru spectrul live, intensitate, verificări stereo și un raport audio ACX.

## Înainte de a începe

Deschide un proiect cu audio. Decide dacă vrei să inspectezi redarea sau un interval selectat: o selecție temporală poate comuta spectrul la analiza selecției.

## Pași

1. Deschide **Analizează > Dialog de analiză**. Extinde secțiunile necesare, precum **Spectrum**, spectrograma, intensitatea sau corelația.
2. Șterge selecția temporală și pornește redarea pentru vizualizarea live. Compară suprapunerile pistelor în spectru pentru a identifica benzi de frecvență concurente.
3. Oprește și selectează un pasaj pentru a-i inspecta spectrul fără redare.
4. Pentru verificări de audiobook, extinde **ACX compliance** și alege **Check audio**. Citește tabelul cu rezultatele; folosește **Export** pentru raportul JSON.

## Verifică rezultatul

Afișajele live răspund la redare. Un raport ACX arată dacă verificările audio trec sau nu, nu doar un indicator. Corectează nivelurile sau setările de format care au eșuat și verifică din nou.

## Limite și recuperare

Spectrul arată energia, nu dacă mixajul sună bine. Corelația și intensitatea necesită context și ascultare. Verificările audio ACX nu garantează acceptarea de către un serviciu de publicare și nu acoperă toate cerințele editoriale. Restrângerea secțiunii ACX șterge verificarea afișată; ruleaz-o din nou când este nevoie. Închide secțiunile de analiză nefolosite pentru a reduce activitatea de afișare.
