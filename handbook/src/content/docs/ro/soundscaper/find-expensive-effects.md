---
title: "Găsește efectele care consumă CPU la redare"
description: "Compară costurile efectelor în timp real înainte de a decide ce procesare să simplifici."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"06fac5e13d2af31e85494e4a5e5b9fa26ae67584fd3365c795c95d63d93a255d","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"06fac5e13d2af31e85494e4a5e5b9fa26ae67584fd3365c795c95d63d93a255d","targetLocale":"ro"} -->

Compară costurile efectelor în timp real înainte de a decide ce procesare să simplifici.

## Înainte de a începe

Folosește un proiect cu efecte în timp real și un pasaj reprezentativ aglomerat. Măsurătorile descriu acest dispozitiv și această sarcină; nu constituie o ierarhie universală a pluginurilor.

## Pași

1. Deschide **Ajutor > CPU profiling**.
2. Începe sau repornește redarea după deschiderea panoului, astfel încât fiecare efect în timp real să poată fi măsurat.
3. Urmărește câteva actualizări. Compară rândurile efectelor cu rândul editorului de bază; ocolește un efect costisitor și redă din nou același pasaj.
4. Închide panoul când ai terminat și restabilește procesarea pe care vrei s-o păstrezi.

## Verifică rezultatul

Utilizarea CPU poate depăși capacitatea unui singur nucleu: 100% reprezintă un nucleu CPU ocupat complet. Compară procentele CPU și ale timpului de procesare scurs. O liniuță înseamnă că nu există o măsurătoare disponibilă, nu un cost nul.

## Limite și recuperare

Timpul de procesare scurs include întârzieri de planificare. Utilizarea GPU și procesele auxiliare externe sunt excluse, iar profilarea în sine adaugă suprasarcină. Un efect ocolit este identificat separat. Deschide **Mai multe opțiuni > Auto-idle** din antetul efectului pentru a permite unui procesor potrivit să intre în repaus pe durata tăcerii. Dezactivează-l pentru efectele care au nevoie de temporizare continuă. Consultă [procesarea locală](/help/local-processing/) pentru setări conexe. Redă întotdeauna același pasaj când compari modificările.
