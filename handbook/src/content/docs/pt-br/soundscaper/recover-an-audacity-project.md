---
title: "Recuperar áudio de um projeto Audacity danificado"
description: "Avalie um projeto danificado e salve o trabalho recuperado em uma cópia separada."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"f4aa18a820f00d839f2a3c2eb08f911c2444e199d6e4fa8e842b5922a215bcd6","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"f4aa18a820f00d839f2a3c2eb08f911c2444e199d6e4fa8e842b5922a215bcd6","targetLocale":"pt-BR"} -->

Avalie um projeto danificado e salve o trabalho recuperado em uma cópia separada.

## Antes de começar

Faça primeiro uma cópia do projeto Audacity danificado. Mantenha juntos os arquivos auxiliares disponíveis. A recuperação aceita `.aup3` compatível e arquivos de projeto não salvos do Audacity, mas não recria amostras que não existem mais.

## Etapas

1. Abra **Arquivo > Gerenciamento de projetos > Recuperar projeto Audacity**.
2. Selecione o projeto danificado. Leia **Recovery assessment** antes de importar ou salvar qualquer coisa.
3. Inspecione **Missing audio ranges**, inclusive as páginas adicionais com locais afetados.
4. Quando disponível, escolha **Save repaired Audacity copy**. Caso contrário, abra o resultado recuperado, confira o relatório de compatibilidade e salve o trabalho com outro nome.

## Verifique o resultado

Reproduza as seções recuperadas e confira lacunas ou silêncios com base no relatório. Verifique se a nova cópia abre antes de depender dela. Guarde o arquivo original danificado para outra tentativa de recuperação.

## Limites e recuperação

A recuperação pode salvar prefixos de áudio válidos e substituir amostras ausentes por silêncio. Um banco de dados reparado não significa que todo o áudio sobreviveu ou que todos os recursos nativos de edição foram transferidos. Leia as omissões relatadas e nunca sobrescreva o único original durante o diagnóstico. Para projetos intactos, use o [guia de importação do Audacity](/guides/projects/open-an-audacity-project/).
