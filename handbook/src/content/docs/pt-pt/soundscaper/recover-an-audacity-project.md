---
title: "Recuperar áudio de um projecto Audacity danificado"
description: "Avalie um projecto danificado e guarde o trabalho recuperado como cópia separada."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"f4aa18a820f00d839f2a3c2eb08f911c2444e199d6e4fa8e842b5922a215bcd6","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"f4aa18a820f00d839f2a3c2eb08f911c2444e199d6e4fa8e842b5922a215bcd6","targetLocale":"pt-PT"} -->

Avalie um projecto danificado e guarde o trabalho recuperado como cópia separada.

## Antes de começar

Faça primeiro uma cópia do projecto Audacity danificado. Mantenha juntos todos os ficheiros auxiliares disponíveis. A recuperação suporta `.aup3` e ficheiros de projecto não guardados do Audacity, mas não consegue recriar amostras que já não existam.

## Passos

1. Abra **Ficheiro > Gestão de projetos > Recuperar projeto Audacity**.
2. Seleccione o projecto danificado. Leia **Recovery assessment** antes de importar ou guardar qualquer coisa.
3. Inspeccione **Missing audio ranges**, incluindo as páginas adicionais com as localizações afectadas.
4. Quando disponível, escolha **Save repaired Audacity copy**. Caso contrário, abra o resultado recuperado, consulte o relatório de compatibilidade e guarde o trabalho com um novo nome.

## Verificar o resultado

Reproduza as secções recuperadas e verifique as lacunas ou o silêncio com base no relatório. Confirme que a nova cópia abre antes de confiar nela. Guarde o ficheiro danificado original para outra tentativa de recuperação.

## Limites e recuperação

A recuperação pode salvar prefixos de áudio válidos e substituir amostras em falta por silêncio. Uma base de dados reparada não significa que todo o áudio tenha sobrevivido ou que todas as funcionalidades de edição nativas tenham sido transferidas. Leia as omissões indicadas e nunca substitua o único original durante o diagnóstico. Para projectos intactos, utilize o [guia de importação do Audacity](/guides/projects/open-an-audacity-project/).
