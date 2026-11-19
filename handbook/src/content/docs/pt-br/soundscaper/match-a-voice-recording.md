---
title: "Igualar o timbre de uma gravação de voz"
description: "Aprenda uma referência tonal e use o Match EQ para aproximar outra gravação dela."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"2b6667d165ad26e0b7420dc98e595da9045ad4ca45fdda417a37a2d3e697c0e4","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"2b6667d165ad26e0b7420dc98e595da9045ad4ca45fdda417a37a2d3e697c0e4","targetLocale":"pt-BR"} -->

Aprenda uma referência tonal e use o Match EQ para aproximar outra gravação dela.

## Antes de começar

Escolha uma referência audível com faixa de frequência completa e duração mínima de um quarto de segundo, de preferência do mesmo locutor em uma boa gravação. Deixe a gravação de destino pronta. O processamento é local tanto no navegador quanto no desktop.

## Etapas

1. Selecione a referência e abra **Efeito > EQ e filtros > Match EQ**. Escolha **Learn reference from selection**.
2. Salve a referência aprendida como preset se quiser reutilizar esse perfil de voz. Feche a janela.
3. Selecione o destino, abra o Match EQ novamente, recupere a referência se necessário e escolha **Analyze target**.
4. Use **Pré-visualização** para comparar **Original** e **Matched (level compensated)**. Ajuste a correção e escolha **Aplicar à seleção** ou **Edit as Filter Curve EQ** para editar a curva.

## Verifique o resultado

Ouça em volume semelhante para comparar o equilíbrio tonal. O áudio processado mantém a duração e a quantidade de canais. **Desfazer** desfaz a aplicação.

## Limites e recuperação

O Match EQ não restaura largura de banda ausente e não iguala desempenho, dinâmica, reverberação do ambiente ou identidade vocal. A captura da referência inclui efeitos da faixa antes dos buses e do master; o destino é analisado antes do rack da faixa. Renderize uma referência primeiro quando o som desejado depender do processamento posterior.
