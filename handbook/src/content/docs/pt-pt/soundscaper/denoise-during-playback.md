---
title: "Reduzir ruído durante a reprodução"
description: "Adicione um efeito de redução de ruído por IA em tempo real a uma faixa de diálogo."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"48233da1a6a6383c3a32842c992910b81829a02ec6bf2017024cbda63dfe01d6","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"48233da1a6a6383c3a32842c992910b81829a02ec6bf2017024cbda63dfe01d6","targetLocale":"pt-PT"} -->

Adicione um efeito de redução de ruído por IA em tempo real a uma faixa de diálogo.

## Antes de começar

Utilize o Soundscaper para computador. Abra **Ferramentas > Gestor de Modelos** e instale o modelo de redução de ruído em tempo real e o runtime correspondente disponibilizados pela sua compilação. A instalação requer uma transferência explícita; apenas o navegador não consegue executar este efeito nativo.

## Passos

1. Seleccione a faixa de diálogo com ruído e abra o respectivo rack de efeitos em tempo real.
2. Escolha **Adicionar efeito** e seleccione **AI denoising (DPDFNet2)**.
3. Inicie a reprodução e compare com o efeito ignorado através do botão de alimentação.
4. Ajuste a mistura à volta da faixa limpa e ouça a exportação antes da entrega. Guarde o projecto para manter o rack.

## Verificar o resultado

O ruído deve diminuir sem comprometer a inteligibilidade da fala. Verifique consoantes suaves, respirações e o início da reprodução. Se notar oscilações de volume ou perda de fala, ignore o efeito e compare com o original.

## Limites e recuperação

Trata-se de redução de ruído de fala, não de um efeito geral de restauro de música. A reprodução noutro computador requer o modelo compatível e o runtime nativo. Se o efeito não estiver disponível, verifique a instalação e o suporte da versão para computador; utilize o [restauro de fala offline](/soundscaper/restore-damaged-speech/) quando precisar de um resultado renderizado e revisto. A transferência de um modelo não garante melhorias em todas as gravações.
