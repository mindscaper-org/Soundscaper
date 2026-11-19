---
title: "Randează un program ADM pentru difuzoare"
description: "Exportă beds și obiecte ADM create ca audio obișnuit pentru difuzoare, folosind EBU EAR."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"5af5c8eeeac85ba578ac51c27f066d77851b7c1a9128257d3b919b71a1c76825","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"5af5c8eeeac85ba578ac51c27f066d77851b7c1a9128257d3b919b71a1c76825","targetLocale":"ro"} -->

Exportă beds și obiecte ADM create ca audio obișnuit pentru difuzoare, folosind EBU EAR.

## Înainte de a începe

Creează un program ADM în fila ADM a editorului Metadata, cu atribuiri de bed și obiecte poziționate. Cunoaște aspectul difuzoarelor de livrare și alege un container și un codec care pot transporta numărul de canale dorit.

## Pași

1. Deschide **Fișier > Exportă audio**.
2. În **Randare > EBU EAR speaker rendering**, alege un aspect: stereo, 5.1, 5.1.2, 5.1.4, 7.1 sau 7.1.4.
3. Verifică formatul de ieșire, numărul de canale și nivelurile, apoi exportă.
4. Citește raportul de livrare și ascultă fișierul exportat prin aspectul de difuzoare corespunzător.

## Verifică rezultatul

Ieșirea conține PCM randat pentru difuzoare în ordinea declarată a canalelor. Această opțiune de export nu modifică monitorizarea proiectului sau creația ADM originală. Verifică în raport rendererul și aspectul folosite.

## Limite și recuperare

Randarea EAR pentru difuzoare nu poate fi combinată cu randarea pentru căști. Ieșirile împărțite și passthrough-ul BW64/ADM nu pot folosi această opțiune. Canalele randate nu transportă metadatele ADM originale bed/object; folosește BW64 nerandat pentru acest schimb. Obiectele mobile sau difuze, HOA, gestionarea basului și randarea Dolby certificată nu fac parte din această funcție. Indicatorul obișnuit de intensitate acceptă cel mult opt canale livrate.
