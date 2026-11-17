---
title: "Editar áudio falado pela transcrição"
description: "Selecione palavras em uma transcrição cronometrada para navegar até o áudio e editá-lo."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"35cf6dc5dcd0c0b08f82de0511870ac68a3552b5375fd9b5a15e3c0c1d667760","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"35cf6dc5dcd0c0b08f82de0511870ac68a3552b5375fd9b5a15e3c0c1d667760","targetLocale":"pt-BR"} -->

Selecione palavras em uma transcrição cronometrada para navegar até o áudio e editá-lo.

## Antes de começar

Abra um projeto com fala. A geração de uma nova transcrição exige o aplicativo para desktop, um modelo local compatível instalado e seu consentimento explícito. Uma transcrição existente com marcações de tempo pode ser usada sem gerá-la novamente.

## Etapas

1. Abra **Editar > Transcript-based editing**.
2. Quando disponível, escolha **Generate transcript** e siga as solicitações de modelo e permissão. Aguarde até que as faixas de áudio terminem de processar.
3. Clique em uma palavra para navegar até o áudio dela. Clique duas vezes para selecioná-la e confira o intervalo destacado na linha do tempo.
4. Com o foco na transcrição, pressione **Backspace** ou **Excluir** para remover as palavras selecionadas e o áudio associado. Ouça a emenda e use **Desfazer** se necessário.

## Verifique o resultado

A transcrição e o áudio são editados juntos; o trecho selecionado fica visível sem alterar o zoom. Salve, feche e reabra o painel para continuar trabalhando com a transcrição mantida.

## Limites e recuperação

A transcrição e o tempo das palavras podem estar errados: ouça antes de excluir. O editor web informa que a geração está disponível apenas no desktop; ele não baixa nem executa um modelo. A transcrição é um recurso de edição, não um registro literal garantido. Mantenha um [instantâneo](/soundscaper/save-session-snapshots/) antes de fazer cortes extensos no diálogo.
