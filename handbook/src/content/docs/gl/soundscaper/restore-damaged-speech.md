---
title: "Restaurar a fala danada cun modelo local"
description: "Revisa o resultado opcional da restauración de fala antes de aplicalo á gravación."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"b0f7979f2aaa38569448b78505dc88a35b1ac2411af570ba9f9d78e7dd80e3e8","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"b0f7979f2aaa38569448b78505dc88a35b1ac2411af570ba9f9d78e7dd80e3e8","targetLocale":"gl"} -->

Revisa o resultado opcional da restauración de fala antes de aplicalo á gravación.

## Antes de comezar

Usa a aplicación de escritorio e selecciona a fala que queres reparar. Conserva o orixinal ou unha instantánea. Os modelos dispoñibles para esta tarefa dependen do catálogo publicado e do runtime instalado; a túa compilación pode non ofrecer VoiceFixer.

## Pasos

1. Abre **Efecto > Eliminación e reparación de ruído > Mellorar o diálogo**.
2. Escolle un **Modelo** compatible. Se está dispoñible, **VoiceFixer** está pensado para reparar o recorte e restaurar a fala; se cómpre, instálao expresamente cos controis de modelos.
3. Executa a tarefa, escolle **Revisar resultado** e escoita o audio proposto xunto ao orixinal.
4. Acepta a proposta só se mellora a fala. Comproba a posición seleccionada antes de aplicala e garda o proxecto.

## Comprobar o resultado

Escoita os picos reparados e a fala máis clara, pero tamén as vogais, respiracións e sons de fondo que puidesen cambiar. O resultado aceptado é unha edición de audio que podes escoitar e desfacer; rexeitar ou pechar a revisión non o aplica.

## Límites e recuperación

VoiceFixer volve sintetizar a fala e pode cambiar o timbre e o contido de fondo. Non é un eliminador xeral de recortes musicais. Se non aparece no selector de modelos, usa un mellorador ofrecido ou a [guía normal para reparar picos recortados](/guides/cleaning-up/restore-clipped-peaks/); estes pasos non poden activar un modelo que non se ofrece.
