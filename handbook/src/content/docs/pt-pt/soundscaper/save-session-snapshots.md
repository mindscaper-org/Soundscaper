---
title: "Guardar e restaurar um instantâneo da sessão"
description: "Guarde uma versão identificada de um arranjo antes de experimentar outra edição."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"586a6024abb3c071bed6969c39294819701ee4a38a48352c412f72dc4fb77827","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"586a6024abb3c071bed6969c39294819701ee4a38a48352c412f72dc4fb77827","targetLocale":"pt-PT"} -->

Guarde uma versão identificada de um arranjo antes de experimentar outra edição.

## Antes de começar

Abra um projecto Soundscaper com permissões de escrita e o áudio que pretende manter. O instantâneo pertence a este projecto; guarde também um ficheiro portátil do projecto como cópia de segurança separada.

## Passos

1. Abra **Ficheiro > Session snapshots**.
2. Introduza um **Snapshot name**, por exemplo, “Antes dos cortes de diálogo”, e escolha **Create snapshot**. Feche a janela e faça as edições.
3. Para regressar a essa versão, volte a abrir a janela, seleccione-a em **Saved snapshots** e escolha **Restore snapshot**.
4. Utilize **Rename snapshot** para clarificar uma versão ou **Delete snapshot** para remover uma de que já não precisa.

## Verificar o resultado

O arranjo anterior e o áudio que este mantinha são restaurados. Feche a janela e reproduza a secção restaurada. **Desfazer** anula a restauração; **Refazer** volta a aplicá-la.

## Limites e recuperação

Um instantâneo é um estado identificado do projecto, não uma cópia de segurança externa. Pode manter áudio removido do arranjo actual e, por isso, ocupar espaço de armazenamento. Eliminar um instantâneo mantém o arranjo actual. Consulte [cópias de segurança de projectos](/projects-and-data/storage-backups-and-privacy/).
