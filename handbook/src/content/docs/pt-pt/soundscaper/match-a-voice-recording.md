---
title: "Igualar o timbre de uma gravação de voz"
description: "Aprenda uma referência tonal e utilize o Match EQ para aproximar outra gravação dessa referência."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"2b6667d165ad26e0b7420dc98e595da9045ad4ca45fdda417a37a2d3e697c0e4","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"2b6667d165ad26e0b7420dc98e595da9045ad4ca45fdda417a37a2d3e697c0e4","targetLocale":"pt-PT"} -->

Aprenda uma referência tonal e utilize o Match EQ para aproximar outra gravação dessa referência.

## Antes de começar

Escolha uma referência audível com a gama completa de frequências e duração de, pelo menos, um quarto de segundo, de preferência do mesmo locutor numa boa gravação. Tenha a gravação de destino pronta. O processamento é local tanto no navegador como na versão para computador.

## Passos

1. Seleccione a referência e abra **Efeito > EQ e filtros > Match EQ**. Escolha **Learn reference from selection**.
2. Guarde a referência aprendida como predefinição se pretender reutilizar este perfil de voz. Feche a janela.
3. Seleccione o destino, volte a abrir o Match EQ, recupere a referência se necessário e escolha **Analyze target**.
4. Utilize **Pré-visualização** para comparar **Original** e **Matched (level compensated)**. Ajuste a correcção e escolha **Aplicar à seleção** ou **Edit as Filter Curve EQ** para editar a curva.

## Verificar o resultado

Ouça com uma intensidade semelhante para comparar melhor o equilíbrio tonal. O áudio processado conserva a duração e o número de canais. **Desfazer** anula a aplicação.

## Limites e recuperação

O Match EQ não recupera largura de banda em falta nem iguala a interpretação, a dinâmica, a reverberação da sala ou a identidade da voz. A captura da referência inclui efeitos da faixa antes dos buses e do master; o destino é analisado antes do rack da faixa. Renderize primeiro uma referência quando o som pretendido depender do processamento posterior.
