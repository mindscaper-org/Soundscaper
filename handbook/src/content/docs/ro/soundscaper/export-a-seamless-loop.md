---
title: "Exportă o buclă cu cozile efectelor"
description: "Înfășoară coada de reverb sau delay la începutul unui fișier audio repetat."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"70ee9977385574f17d5b85641f92c402e911407d0a4c2cb62ccbd14f4d1a6e15","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"70ee9977385574f17d5b85641f92c402e911407d0a4c2cb62ccbd14f4d1a6e15","targetLocale":"ro"} -->

Înfășoară coada de reverb sau delay la începutul unui fișier audio repetat.

## Înainte de a începe

Pregătește un interval de buclă exact cu procesarea dorită. Folosește un format fără pierderi, precum WAV, pentru a verifica îmbinarea. Menține nivelurile obișnuite de redare și export sub clipping.

## Pași

1. Selectează intervalul temporal care trebuie repetat și deschide **Fișier > Exportă audio**.
2. Alege intervalul selectat și un format, o rată de eșantionare și un aspect al canalelor potrivite.
3. Activează **Render as loop** în setările exportului. Exportă fișierul.
4. Importă rezultatul într-un proiect de test și ascultă mai multe repetări, în special la limită.

## Verifică rezultatul

Fișierul exportat păstrează durata aleasă a buclei, iar coada randată se înfășoară la începutul ei. Ascultă după clicuri, salturi de nivel și o tranziție lină a reverberației.

## Limite și recuperare

Înfășurarea cozii nu repară o tăietură muzicală nepotrivită sau o formă de undă uscată discontinuă. Este diferită de adăugarea opțiunii **Include cozi de efecte până la 10 secunde**, care prelungește un export obișnuit. Cozile însumate pot ridica vârfurile; redu nivelul sau folosește limitarea true peak opțională din Limiter și verifică fișierul livrat. Formatele cu pierderi pot introduce padding sau pot schimba vârfurile, așa că verifică și formatul efectiv de destinație.
