---
title: "Igualar o ton dunha gravación de voz"
description: "Aprende unha referencia tonal e usa Match EQ para achegar outra gravación a ela."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"2b6667d165ad26e0b7420dc98e595da9045ad4ca45fdda417a37a2d3e697c0e4","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"2b6667d165ad26e0b7420dc98e595da9045ad4ca45fdda417a37a2d3e697c0e4","targetLocale":"gl"} -->

Aprende unha referencia tonal e usa Match EQ para achegar outra gravación a ela.

## Antes de comezar

Escolle unha referencia audible de ancho de banda completo de polo menos un cuarto de segundo, preferiblemente a mesma persoa ben gravada. Prepara a gravación de destino. O procesamento é local tanto no navegador coma na aplicación de escritorio.

## Pasos

1. Selecciona a referencia e abre **Efecto > EQ e filtros > Match EQ**. Escolle **Learn reference from selection**.
2. Garda a referencia aprendida como preaxuste se queres reutilizar ese perfil vocal. Pecha o diálogo.
3. Selecciona o destino, volve abrir Match EQ, recupera a referencia se cómpre e escolle **Analyze target**.
4. Compara **Orixinal** e **Matched (level compensated)** con **Vista previa**. Axusta a corrección e escolle **Aplicar á selección** ou **Edit as Filter Curve EQ** para editar a curva.

## Comprobar o resultado

Escoita cun volume parecido para comprobar se a balance tonal se achega. O audio aplicado conserva a duración e o número de canles. **Desfacer** reverte a aplicación.

## Límites e recuperación

Match EQ non pode restaurar ancho de banda ausente nin igualar a interpretación, a dinámica, a reverberación da sala ou a identidade da voz. A captura da referencia inclúe os efectos da pista antes dos buses e do master; o destino analízase antes do rack da súa pista. Renderiza primeiro a referencia se o son desexado depende do procesamento posterior.
