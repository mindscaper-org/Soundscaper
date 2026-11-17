---
title: "Restaurar fala danificada com um modelo local"
description: "Revise um resultado opcional de restauração de fala antes de aplicá-lo à gravação."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"b0f7979f2aaa38569448b78505dc88a35b1ac2411af570ba9f9d78e7dd80e3e8","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"b0f7979f2aaa38569448b78505dc88a35b1ac2411af570ba9f9d78e7dd80e3e8","targetLocale":"pt-BR"} -->

Revise um resultado opcional de restauração de fala antes de aplicá-lo à gravação.

## Antes de começar

Use o aplicativo para desktop e selecione a fala a reparar. Mantenha o original ou um instantâneo. Os modelos exibidos para a tarefa dependem do catálogo publicado e do runtime instalado; o VoiceFixer pode não estar disponível na sua build.

## Etapas

1. Abra **Efeito > Remoção e reparo de ruído > Melhorar Diálogo**.
2. Escolha um **Modelo** compatível. Quando oferecido, o **VoiceFixer** tem como alvo a fala distorcida e sua restauração; instale-o explicitamente pelos controles de modelo se necessário.
3. Execute a tarefa, escolha **Revisar resultado** e ouça o áudio proposto ao lado do original.
4. Aceite a proposta somente se a fala melhorar. Confira o local escolhido antes de aplicar e salve o projeto.

## Verifique o resultado

Ouça os picos reparados e a fala mais clara, mas observe também as vogais, respirações e sons de fundo alterados. O resultado aceito é uma edição de áudio que pode ser ouvida e desfeita; rejeitar ou fechar a revisão não aplica nada.

## Limites e recuperação

O VoiceFixer ressintetiza a fala e pode alterar o timbre e o conteúdo de fundo. Não é um restaurador geral de picos cortados em música. Se ele não aparecer no seletor, use um aprimorador oferecido ou o [guia comum de reparo de picos cortados](/guides/cleaning-up/restore-clipped-peaks/); não é possível ativar um modelo que a build não oferece seguindo estas etapas.
