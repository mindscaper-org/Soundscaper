---
title: "Renderizar um programa ADM para colunas"
description: "Exporte beds e objectos ADM criados como áudio normal para colunas através do EBU EAR."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"5af5c8eeeac85ba578ac51c27f066d77851b7c1a9128257d3b919b71a1c76825","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"5af5c8eeeac85ba578ac51c27f066d77851b7c1a9128257d3b919b71a1c76825","targetLocale":"pt-PT"} -->

Exporte beds e objectos ADM criados como áudio normal para colunas através do EBU EAR.

## Antes de começar

Crie um programa ADM no separador ADM do editor Metadata, com atribuições de beds e objectos posicionados. Conheça a disposição das colunas de destino e escolha um contentor e um codec que suportem o número de canais.

## Passos

1. Abra **Ficheiro > Exportar áudio**.
2. Em **Renderização > EBU EAR speaker rendering**, escolha uma disposição: estéreo, 5.1, 5.1.2, 5.1.4, 7.1 ou 7.1.4.
3. Verifique o formato de saída, o número de canais e os níveis e, em seguida, exporte.
4. Leia o relatório de entrega e ouça o ficheiro exportado através da disposição de colunas correspondente.

## Verificar o resultado

A saída contém PCM renderizado para colunas, pela ordem de canais declarada. Esta opção de exportação não altera a monitorização do projecto nem a criação ADM original. Verifique no relatório o renderizador e a disposição utilizados.

## Limites e recuperação

O processamento de colunas EAR não pode ser combinado com o processamento para auscultadores. Saídas divididas e passthrough BW64/ADM não podem utilizar esta opção. Os canais renderizados não transportam os metadados ADM originais de bed/object; utilize BW64 não renderizado para esse intercâmbio. Objectos móveis ou difusos, HOA, gestão de graves e renderização Dolby certificada não são abrangidos. O medidor de intensidade sonora normal suporta, no máximo, oito canais entregues.
