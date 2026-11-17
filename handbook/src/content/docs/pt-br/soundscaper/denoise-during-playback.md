---
title: "Reduzir ruído durante a reprodução"
description: "Adicione um efeito de redução de ruído por IA em tempo real a uma faixa de diálogo."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"48233da1a6a6383c3a32842c992910b81829a02ec6bf2017024cbda63dfe01d6","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"48233da1a6a6383c3a32842c992910b81829a02ec6bf2017024cbda63dfe01d6","targetLocale":"pt-BR"} -->

Adicione um efeito de redução de ruído por IA em tempo real a uma faixa de diálogo.

## Antes de começar

Use o Soundscaper para desktop. Abra **Ferramentas > Gerenciador de Modelos** e instale o modelo de redução de ruído em tempo real e o runtime correspondente oferecidos pela sua build. Instalar um modelo exige um download explícito; só o navegador não executa esse efeito nativo.

## Etapas

1. Selecione a faixa de diálogo com ruído e abra o rack de efeitos em tempo real.
2. Escolha **Adicionar efeito** e selecione **AI denoising (DPDFNet2)**.
3. Inicie a reprodução e compare com o efeito ignorado usando o botão liga/desliga.
4. Ajuste a mixagem ao redor da faixa limpa e ouça a exportação antes da entrega. Salve o projeto para manter o rack.

## Verifique o resultado

O ruído deve diminuir enquanto a fala permanece inteligível. Confira consoantes suaves, respirações e o início da reprodução. Se ouvir bombeamento ou fala ausente, ignore o efeito e compare com o original.

## Limites e recuperação

É uma redução de ruído para fala, não um efeito geral de restauração musical. A reprodução em outro computador exige o modelo compatível e o runtime nativo. Se o efeito não estiver disponível, confira a instalação e o suporte no desktop; use a [restauração de fala offline](/soundscaper/restore-damaged-speech/) quando precisar de um resultado renderizado e revisado. Baixar um modelo não garante que todas as gravações melhorem.
