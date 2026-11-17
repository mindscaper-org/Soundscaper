---
title: "Aplicar efeitos em tempo real a um clip"
description: "Dê a um clip de áudio o seu próprio rack de efeitos sem processar todos os clips da faixa."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"0d37cd5c96e28ec54b0e1f2cb991c996e77e1e10a9b8583b806ac616d53a87f2","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"0d37cd5c96e28ec54b0e1f2cb991c996e77e1e10a9b8583b806ac616d53a87f2","targetLocale":"pt-PT"} -->

Dê a um clip de áudio o seu próprio rack de efeitos sem processar todos os clips da faixa.

## Antes de começar

Seleccione um clip de áudio no Soundscaper. Os efeitos do clip fazem parte do processamento desse clip e alimentam os efeitos da faixa; o processamento da faixa e do master também pode alterar o que ouve.

## Passos

1. Abra **Janela > Propriedades do clip** e expanda **Efeitos**. Este é o rack de efeitos do clip.
2. Escolha **Adicionar efeito**, seleccione um efeito e ajuste as respectivas definições. Reproduza o clip para o ouvir.
3. Utilize o botão de alimentação do efeito para comparar o som com e sem processamento. Reordene ou remova efeitos do rack conforme necessário.
4. Guarde o projecto e ouça o clip com os que lhe são adjacentes. Utilize **Desfazer** se a alteração não ajudar.

## Verificar o resultado

O clip escolhido tem processamento próprio e os restantes mantêm as respectivas definições. Ouça para lá do seu fim para detectar uma cauda de reverberação ou delay. Verifique o rack da faixa se o resultado combinado for demasiado forte.

## Limites e recuperação

A cauda de um efeito pode prolongar-se para além do áudio de origem do clip; verifique as opções de caudas de exportação antes da entrega. Para um detector Auto Duck, escolha outra faixa adequada; as realimentações em ciclo são recusadas. Abra **Mais opções > Auto-idle** no cabeçalho do efeito para controlar a suspensão durante o silêncio. Desactive-a para plug-ins sensíveis ao tempo. Consulte [processamento local](/help/local-processing/) para definições relacionadas.
