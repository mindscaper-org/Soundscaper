---
title: "Individuare gli effetti che consumano CPU durante la riproduzione"
description: "Confronta il costo degli effetti in tempo reale prima di decidere quale elaborazione semplificare."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"06fac5e13d2af31e85494e4a5e5b9fa26ae67584fd3365c795c95d63d93a255d","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"06fac5e13d2af31e85494e4a5e5b9fa26ae67584fd3365c795c95d63d93a255d","targetLocale":"it"} -->

Confronta il costo degli effetti in tempo reale prima di decidere quale elaborazione semplificare.

## Prima di iniziare

Usa un progetto con effetti in tempo reale e un passaggio impegnativo rappresentativo. Le misurazioni descrivono questo dispositivo e questo carico di lavoro; non sono una classifica universale dei plug-in.

## Passaggi

1. Apri **Aiuto > CPU profiling**.
2. Dopo aver aperto il pannello, avvia o riavvia la riproduzione affinché sia possibile misurare ogni effetto in tempo reale.
3. Osserva diversi aggiornamenti. Confronta le righe degli effetti con la riga base dell’editor, bypassa un effetto costoso e ripeti lo stesso passaggio.
4. Al termine, chiudi il pannello e ripristina l’elaborazione che vuoi mantenere.

## Verificare il risultato

L’uso della CPU può superare la capacità di un singolo core: il 100% indica un core CPU completamente occupato. Confronta le percentuali di CPU e di tempo di elaborazione trascorso. Un trattino significa che non è disponibile una misurazione, non che il costo sia zero.

## Limiti e recupero

Il tempo di elaborazione trascorso include ritardi di pianificazione. L’uso della GPU e i processi helper esterni sono esclusi; anche la profilazione aggiunge overhead. Un effetto bypassato è indicato separatamente. Apri **Altre opzioni > Auto-idle** nell’intestazione di un effetto per consentire a un processore adatto di entrare in modalità inattiva durante il silenzio. Disattivala per gli effetti che richiedono tempi continui. Consulta [l’elaborazione locale](/help/local-processing/) per le impostazioni correlate. Riproduci sempre lo stesso passaggio per confrontare le modifiche.
