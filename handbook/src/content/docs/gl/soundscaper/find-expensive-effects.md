---
title: "Atopar efectos que consumen CPU durante a reprodución"
description: "Compara o custo dos efectos en tempo real antes de decidir que procesamento simplificar."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"06fac5e13d2af31e85494e4a5e5b9fa26ae67584fd3365c795c95d63d93a255d","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"06fac5e13d2af31e85494e4a5e5b9fa26ae67584fd3365c795c95d63d93a255d","targetLocale":"gl"} -->

Compara o custo dos efectos en tempo real antes de decidir que procesamento simplificar.

## Antes de comezar

Usa un proxecto con efectos en tempo real e unha pasaxe representativa e esixente. As medicións describen este dispositivo e esta carga de traballo; non son unha clasificación universal dos complementos.

## Pasos

1. Abre **Axuda > CPU profiling**.
2. Inicia ou reinicia a reprodución despois de abrir o panel para que se mida cada efecto en tempo real.
3. Observa varias actualizacións. Compara as filas de efectos coa fila básica do editor, omite un efecto custoso e volve reproducir a mesma pasaxe.
4. Ao rematar, pecha o panel e restaura o procesamento que queiras conservar.

## Comprobar o resultado

O uso da CPU pode superar a capacidade dun só núcleo: o 100 % representa un núcleo da CPU plenamente ocupado. Compara as porcentaxes de CPU e do tempo de procesamento transcorrido. Un guión indica que non hai ningunha medición dispoñible, non que o custo sexa cero.

## Límites e recuperación

O tempo de procesamento transcorrido inclúe atrasos de planificación. Exclúense o uso da GPU e os procesos auxiliares externos; o perfilado tamén engade sobrecarga. Os efectos omitidos identifícanse por separado. Abre **Máis opcións > Auto-idle** na cabeceira dun efecto para que un procesador axeitado poida repousar durante o silencio. Desactívao nos efectos que precisan temporización continua. Consulta [procesamento local](/help/local-processing/) para ver axustes relacionados. Reproduce sempre a mesma pasaxe ao comparar cambios.
