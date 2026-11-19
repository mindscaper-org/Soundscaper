---
title: "Redu scurgerea de sunet între microfoanele de dialog"
description: "Creează anvelope de câștig editabile pentru a reduce scurgerea corelată de pe microfoanele inactive."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"5c9e85ea0bae3f0c6489f0b5a3235c11e843612c88fa8c2076a4c00e82937752","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"5c9e85ea0bae3f0c6489f0b5a3235c11e843612c88fa8c2076a4c00e82937752","targetLocale":"ro"} -->

Creează anvelope de câștig editabile pentru a reduce scurgerea corelată de pe microfoanele inactive.

## Înainte de a începe

Folosește două până la opt piste de dialog aliniate în timp, ideal câte un microfon pentru fiecare persoană și câștiguri de înregistrare comparabile. Selectează un interval temporal pozitiv cu audio pe fiecare pistă aleasă. Deblochează pistele și dezgheață-le.

## Pași

1. Selectează pistele microfoanelor și pasajul de procesat.
2. Deschide **Efect > Eliminarea și repararea zgomotului > Automatic microphone-bleed reduction**.
3. Începe cu setările implicite și alege **Create gain envelopes**.
4. Redă pasajul, mai ales întreruperile și vorbirea suprapusă. Folosește **Amplificarea clipului** pentru a ajusta punctele generate care reduc vorbirea dorită.

## Verifică rezultatul

Punctele de câștig reduc scurgerea, în timp ce sursele originale și pozițiile clipurilor rămân disponibile. Verifică intrările fiecărui vorbitor și marginile selecției. **Revenire** elimină operația; **Refă** o restabilește.

## Limite și recuperare

Funcția nu aliniază înregistrările și nu separă vocile dintr-un microfon activ. Diferențele mari de câștig, reverberația și vorbirea încetă sub scurgerea puternică pot cauza erori. Pentru alte setări, anulează prima aplicare: aplicările repetate cumulează atenuarea. Selecțiile spectrale, pistele blocate și pistele înghețate nu pot fi procesate.
