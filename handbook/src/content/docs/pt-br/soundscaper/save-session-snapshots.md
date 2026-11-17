---
title: "Salvar e restaurar um instantâneo da sessão"
description: "Guarde uma versão nomeada de um arranjo antes de experimentar outra edição."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"586a6024abb3c071bed6969c39294819701ee4a38a48352c412f72dc4fb77827","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"586a6024abb3c071bed6969c39294819701ee4a38a48352c412f72dc4fb77827","targetLocale":"pt-BR"} -->

Guarde uma versão nomeada de um arranjo antes de experimentar outra edição.

## Antes de começar

Abra um projeto Soundscaper gravável que contenha o áudio que deseja manter. O instantâneo pertence a esse projeto; salve também um arquivo portátil do projeto como backup separado.

## Etapas

1. Abra **Arquivo > Session snapshots**.
2. Digite um **Snapshot name**, como “Antes dos cortes do diálogo”, e escolha **Create snapshot**. Feche a janela e faça suas edições.
3. Para voltar a essa versão, abra novamente a janela, selecione-a em **Saved snapshots** e escolha **Restore snapshot**.
4. Use **Rename snapshot** para deixar a versão mais clara ou **Delete snapshot** para remover uma que não seja mais necessária.

## Verifique o resultado

O arranjo anterior e o áudio que ele mantinha são restaurados. Feche a janela e reproduza o trecho restaurado. **Desfazer** desfaz a restauração; **Refazer** a restaura novamente.

## Limites e recuperação

Um instantâneo é um estado nomeado do projeto, não um backup externo. Ele pode manter áudio removido do arranjo atual e, portanto, ocupar espaço. Excluir um instantâneo mantém o arranjo atual. Consulte [backups de projetos](/projects-and-data/storage-backups-and-privacy/).
