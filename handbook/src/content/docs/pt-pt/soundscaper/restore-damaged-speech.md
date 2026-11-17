---
title: "Restaurar fala danificada com um modelo local"
description: "Reveja um resultado opcional de restauro de fala antes de o aplicar à gravação."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"b0f7979f2aaa38569448b78505dc88a35b1ac2411af570ba9f9d78e7dd80e3e8","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"b0f7979f2aaa38569448b78505dc88a35b1ac2411af570ba9f9d78e7dd80e3e8","targetLocale":"pt-PT"} -->

Reveja um resultado opcional de restauro de fala antes de o aplicar à gravação.

## Antes de começar

Utilize a aplicação para computador e seleccione a fala a reparar. Mantenha o original ou um instantâneo. Os modelos apresentados para a tarefa dependem do catálogo publicado e do runtime instalado; o VoiceFixer pode não ser disponibilizado pela sua compilação.

## Passos

1. Abra **Efeito > Remoção e reparação de ruído > Melhorar diálogo**.
2. Escolha um **Modelo** compatível. Quando disponibilizado, o **VoiceFixer** destina-se a reparar fala cortada; instale-o explicitamente através dos controlos do modelo, se necessário.
3. Execute a tarefa, escolha **Rever resultado** e ouça o áudio proposto juntamente com o original.
4. Aceite a proposta apenas se a fala melhorar. Verifique o local escolhido antes de a aplicar e guarde o projecto.

## Verificar o resultado

Ouça os picos reparados e a fala mais nítida, mas preste também atenção às vogais, respirações e som de fundo alterados. O resultado aceite é uma edição de áudio que pode ouvir e anular; rejeitar ou fechar a revisão não aplica alterações.

## Limites e recuperação

O VoiceFixer volta a sintetizar a fala e pode alterar o timbre e o conteúdo de fundo. Não é um recuperador geral de picos de música cortados. Se não aparecer no selector de modelos, utilize um melhorador disponibilizado ou o [guia habitual para reparar picos cortados](/guides/cleaning-up/restore-clipped-peaks/); não é possível activar um modelo não disponibilizado seguindo estes passos.
