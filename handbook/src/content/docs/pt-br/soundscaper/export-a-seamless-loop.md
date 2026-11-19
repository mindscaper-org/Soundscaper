---
title: "Exportar um loop com as caudas dos efeitos"
description: "Encaixe a cauda de reverberação ou delay no início de um arquivo de áudio repetido."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"70ee9977385574f17d5b85641f92c402e911407d0a4c2cb62ccbd14f4d1a6e15","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"70ee9977385574f17d5b85641f92c402e911407d0a4c2cb62ccbd14f4d1a6e15","targetLocale":"pt-BR"} -->

Encaixe a cauda de reverberação ou delay no início de um arquivo de áudio repetido.

## Antes de começar

Prepare um intervalo exato de loop com o processamento desejado. Use um formato sem perdas, como WAV, para conferir a junção. Mantenha os níveis normais de reprodução e exportação abaixo do clipping.

## Etapas

1. Selecione o intervalo de tempo que deve se repetir e abra **Arquivo > Exportar áudio**.
2. Escolha o intervalo selecionado e um formato, uma taxa de amostragem e um layout de canais adequados.
3. Ative **Render as loop** nas configurações de exportação. Exporte o arquivo.
4. Importe o resultado para um projeto de teste e ouça várias repetições, especialmente a transição.

## Verifique o resultado

O arquivo exportado mantém a duração escolhida para o loop e a cauda renderizada reaparece no início. Verifique se há cliques ou aumento de nível e se a transição de reverberação é suave.

## Limites e recuperação

Encaixar a cauda não corrige um corte musical inadequado nem uma forma de onda seca descontínua. É diferente de acrescentar **Incluir caudas de efeito de até 10 segundos**, que aumenta a duração de uma exportação comum. Caudas somadas podem elevar os picos; reduza o nível ou use a limitação de true peak opcional do Limiter e confira o arquivo final. Formatos com perdas podem inserir padding ou alterar os picos, então verifique também o formato de destino real.
