---
title: "Renderizzare un programma ADM per altoparlanti"
description: "Esporta bed e oggetti ADM creati da te come normale audio per altoparlanti tramite EBU EAR."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"5af5c8eeeac85ba578ac51c27f066d77851b7c1a9128257d3b919b71a1c76825","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"5af5c8eeeac85ba578ac51c27f066d77851b7c1a9128257d3b919b71a1c76825","targetLocale":"it"} -->

Esporta bed e oggetti ADM creati da te come normale audio per altoparlanti tramite EBU EAR.

## Prima di iniziare

Crea un programma ADM nella scheda ADM dell’editor di metadati, con assegnazioni bed e oggetti posizionati. Definisci la disposizione degli altoparlanti di consegna e scegli un contenitore e un codec che supportino il numero di canali.

## Passaggi

1. Apri **File > Esporta audio**.
2. In **Rendering > EBU EAR speaker rendering**, scegli una disposizione: stereo, 5.1, 5.1.2, 5.1.4, 7.1 o 7.1.4.
3. Controlla formato di uscita, numero di canali e impostazioni di livello, poi esporta.
4. Leggi il rapporto di consegna e ascolta il file esportato tramite la disposizione di altoparlanti corrispondente.

## Verificare il risultato

L’uscita contiene PCM renderizzato per altoparlanti nell’ordine dei canali dichiarato. Questa opzione di esportazione non modifica il monitoring del progetto né l’authoring ADM originale. Controlla nel rapporto il renderer e la disposizione usati.

## Limiti e recupero

Il rendering EAR per altoparlanti non può essere combinato con il rendering per cuffie. Le uscite separate e il passthrough BW64/ADM non possono usare questa opzione. I canali renderizzati non conservano i metadati ADM originali relativi a bed/object; per questo scambio usa BW64 non renderizzato. Gli oggetti mobili o diffusi, HOA, la gestione dei bassi e il rendering Dolby certificato non rientrano nella funzione. Il misuratore di loudness ordinario supporta al massimo otto canali consegnati.
