---
title: "Aplicar efeitos em tempo real a um clipe"
description: "Dê a um clipe de áudio seu próprio rack de efeitos sem processar todos os clipes da faixa."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"0d37cd5c96e28ec54b0e1f2cb991c996e77e1e10a9b8583b806ac616d53a87f2","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"0d37cd5c96e28ec54b0e1f2cb991c996e77e1e10a9b8583b806ac616d53a87f2","targetLocale":"pt-BR"} -->

Dê a um clipe de áudio seu próprio rack de efeitos sem processar todos os clipes da faixa.

## Antes de começar

Selecione um clipe de áudio no Soundscaper. Os efeitos do clipe fazem parte do processamento dele e alimentam os efeitos da faixa; o processamento da faixa e do master ainda pode alterar o que você ouve.

## Etapas

1. Abra **Janela > Propriedades do clipe** e expanda **Efeitos**. Esse é o rack de efeitos do clipe.
2. Escolha **Adicionar efeito**, selecione um efeito e ajuste as configurações. Reproduza o clipe para ouvi-lo.
3. Use o botão liga/desliga do efeito para comparar o som processado e o som sem processamento. Reordene ou remova efeitos do rack conforme necessário.
4. Salve o projeto e ouça o clipe junto com os vizinhos. Use **Desfazer** se a alteração não ajudar.

## Verifique o resultado

O clipe escolhido tem processamento próprio, enquanto os outros mantêm suas configurações. Ouça além do fim dele para verificar uma cauda de reverberação ou delay. Confira o rack da faixa se o resultado combinado estiver forte demais.

## Limites e recuperação

Uma cauda de efeito pode durar mais que o áudio de origem do clipe; verifique as opções de cauda na exportação antes de entregar o arquivo. Para um detector Auto Duck, escolha outra faixa adequada; loops de feedback são recusados. Abra **Mais opções > Auto-idle** no cabeçalho do efeito para controlar o modo de repouso durante o silêncio. Desative-o para plug-ins sensíveis ao tempo. Consulte [processamento local](/help/local-processing/) para ver configurações relacionadas.
