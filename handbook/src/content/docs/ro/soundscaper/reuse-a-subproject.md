---
title: "Reutilizează un proiect salvat ca audio conectat"
description: "Inserează un proiect salvat într-un alt aranjament și urmărește editările sale ulterioare."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"ff1eb7c442461290d4b0b61fc89870619cc8872f4ee2143e65283db0dc1defa9","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"ff1eb7c442461290d4b0b61fc89870619cc8872f4ee2143e65283db0dc1defa9","targetLocale":"ro"} -->

Inserează un proiect salvat într-un alt aranjament și urmărește editările sale ulterioare.

## Înainte de a începe

Salvează proiectul copil Soundscaper în aceeași bibliotecă locală de proiecte. Încheie mai întâi mixajul. Randează și fixează în audio procesarea pluginurilor native active înainte de a folosi rendererul de subproiecte din fundal.

## Pași

1. Deschide proiectul părinte și alege **Fișier > Subprojects**.
2. Alege proiectul copil din **Project to insert or relink**, apoi selectează **Insert subproject**. Mixajul publicat apare pe o pistă nouă.
3. Selectează legătura din **Linked subprojects** și alege **Open subproject** pentru a edita copilul. Salvează-l și revino la părinte pentru a asculta audio-ul actualizat.
4. Alege **Pin current audio** pentru a păstra această revizie sau **Make independent audio** pentru a nu mai urmări proiectul copil.

## Verifică rezultatul

Poziția în proiectul părinte rămâne aceeași când copilul se actualizează. Redă audio-ul după reîmprospătare și verifică începutul și sfârșitul. Un mixaj copil mai scurt este completat cu liniște în intervalul publicat inițial.

## Limite și recuperare

Durata publicată și aspectul canalelor rămân fixe; inserează o altă plasare pentru un interval diferit. Un fișier portabil al părintelui include audio-ul instalat, dar nu și proiectul copil editabil. Transferă separat copilul și folosește **Relink to selected project**. Legăturile ciclice sunt refuzate.
