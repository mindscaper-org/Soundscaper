---
title: "Exportar um ciclo com as caudas dos efeitos"
description: "Faça passar a cauda de reverberação ou delay para o início de um ficheiro de áudio repetido."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"70ee9977385574f17d5b85641f92c402e911407d0a4c2cb62ccbd14f4d1a6e15","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"70ee9977385574f17d5b85641f92c402e911407d0a4c2cb62ccbd14f4d1a6e15","targetLocale":"pt-PT"} -->

Faça passar a cauda de reverberação ou delay para o início de um ficheiro de áudio repetido.

## Antes de começar

Prepare um intervalo de ciclo exacto com o processamento pretendido. Utilize um formato sem perdas, como WAV, para verificar a junção. Mantenha os níveis normais de reprodução e exportação abaixo do clipping.

## Passos

1. Seleccione o intervalo de tempo que pretende repetir e abra **Ficheiro > Exportar áudio**.
2. Escolha o intervalo seleccionado e um formato, uma frequência de amostragem e uma disposição de canais adequados.
3. Active **Render as loop** nas definições de exportação. Exporte o ficheiro.
4. Importe o resultado para um projecto de teste e ouça várias repetições, sobretudo na junção.

## Verificar o resultado

O ficheiro exportado mantém a duração escolhida para o ciclo e a cauda renderizada passa para o respectivo início. Verifique se há estalidos ou um aumento de nível e se a transição da reverberação é suave.

## Limites e recuperação

O encaixe da cauda não corrige um corte musical inadequado nem uma forma de onda seca descontínua. É diferente de acrescentar **Incluir caudas de efeito até 10 segundos**, que prolonga uma exportação normal. A soma das caudas pode elevar os picos; reduza o nível ou utilize a limitação true peak opcional do Limiter e verifique o ficheiro final. Formatos com perdas podem acrescentar padding ou alterar os picos, pelo que deve também verificar o formato de destino real.
