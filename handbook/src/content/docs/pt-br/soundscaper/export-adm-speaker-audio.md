---
title: "Renderizar um programa ADM para alto-falantes"
description: "Exporte beds e objetos ADM criados como áudio comum para alto-falantes usando EBU EAR."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"5af5c8eeeac85ba578ac51c27f066d77851b7c1a9128257d3b919b71a1c76825","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"5af5c8eeeac85ba578ac51c27f066d77851b7c1a9128257d3b919b71a1c76825","targetLocale":"pt-BR"} -->

Exporte beds e objetos ADM criados como áudio comum para alto-falantes usando EBU EAR.

## Antes de começar

Crie um programa ADM na aba ADM do editor Metadata, com atribuições de bed e objetos posicionados. Saiba qual é o layout de alto-falantes de entrega e escolha um contêiner e codec que comportem a quantidade de canais.

## Etapas

1. Abra **Arquivo > Exportar áudio**.
2. Em **Renderização > EBU EAR speaker rendering**, escolha um layout: estéreo, 5.1, 5.1.2, 5.1.4, 7.1 ou 7.1.4.
3. Confira o formato de saída, a quantidade de canais e os níveis; depois exporte.
4. Leia o relatório de entrega e ouça o arquivo exportado no layout de alto-falantes correspondente.

## Verifique o resultado

A saída contém PCM renderizado para alto-falantes na ordem de canais declarada. Essa opção de exportação não altera a monitoração do projeto nem a criação ADM original. Confira no relatório qual renderizador e layout foram usados.

## Limites e recuperação

A renderização EAR para alto-falantes não pode ser combinada à renderização para fones. Saídas divididas e passthrough BW64/ADM não podem usar essa opção. Os canais renderizados não carregam os metadados ADM originais de bed/object; use BW64 não renderizado para esse intercâmbio. Objetos móveis ou difusos, HOA, gerenciamento de graves e renderização Dolby certificada não fazem parte desse recurso. O medidor de volume comum aceita no máximo oito canais entregues.
