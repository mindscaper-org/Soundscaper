---
title: "Reutilizar un proxecto gardado como audio ligado"
description: "Insire un proxecto gardado noutro arranxo e segue as súas modificacións posteriores."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"ff1eb7c442461290d4b0b61fc89870619cc8872f4ee2143e65283db0dc1defa9","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"ff1eb7c442461290d4b0b61fc89870619cc8872f4ee2143e65283db0dc1defa9","targetLocale":"gl"} -->

Insire un proxecto gardado noutro arranxo e segue as súas modificacións posteriores.

## Antes de comezar

Garda o proxecto fillo de Soundscaper na mesma biblioteca local de proxectos. Remata primeiro a mestura. Renderiza e incorpora ao audio o procesamento activo dos complementos nativos antes de usar o renderizador de subproxectos en segundo plano.

## Pasos

1. Abre o proxecto principal e escolle **Ficheiro > Subprojects**.
2. Selecciona o proxecto fillo en **Project to insert or relink** e escolle **Insert subproject**. A mestura publicada aparece nunha pista nova.
3. Selecciona a ligazón en **Linked subprojects** e escolle **Open subproject** para editar o fillo. Gárdao e volve ao proxecto principal para escoitar o audio actualizado.
4. Escolle **Pin current audio** para conservar esta revisión ou **Make independent audio** para deixar de seguir o fillo.

## Comprobar o resultado

A posición no proxecto principal mantense cando se actualiza o fillo. Reprodúceo despois da actualización e comproba o comezo e o final. Se a mestura do fillo é máis curta, énchese con silencio dentro do intervalo publicado orixinal.

## Límites e recuperación

A duración publicada e a disposición de canles son fixas; insire outra colocación para usar un intervalo diferente. Un ficheiro portátil do proxecto principal inclúe o audio instalado, pero non o proxecto fillo editable. Transfire o fillo á parte e usa **Relink to selected project**. Rexeítanse as ligazóns cíclicas.
