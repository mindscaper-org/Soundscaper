---
title: "Reducir o ruído durante a reprodución"
description: "Engade un efecto de redución de ruído con IA en tempo real a unha pista de diálogo."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"48233da1a6a6383c3a32842c992910b81829a02ec6bf2017024cbda63dfe01d6","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"48233da1a6a6383c3a32842c992910b81829a02ec6bf2017024cbda63dfe01d6","targetLocale":"gl"} -->

Engade un efecto de redución de ruído con IA en tempo real a unha pista de diálogo.

## Antes de comezar

Usa Soundscaper para escritorio. Abre **Ferramentas > Xestor de modelos** e instala o modelo de redución de ruído en tempo real e o runtime compatible que ofreza a túa compilación. A instalación do modelo é unha descarga explícita; o navegador por si só non pode executar este efecto nativo.

## Pasos

1. Selecciona a pista de diálogo ruidosa e abre o seu rack de efectos en tempo real.
2. Escolle **Engade efecto** e selecciona **AI denoising (DPDFNet2)**.
3. Inicia a reprodución e compara o son co efecto omitido mediante o seu botón de acendido.
4. Axusta a mestura arredor da pista limpa e escoita a exportación antes da entrega. Garda o proxecto para conservar o rack.

## Comprobar o resultado

O ruído debería diminuír e a fala seguir sendo intelixible. Comproba as consoantes suaves, as respiracións e o comezo da reprodución. Se hai bombeo ou falta fala, omite o efecto e compara co orixinal.

## Límites e recuperación

Isto elimina ruído da fala; non é un efecto xeral de restauración musical. A reprodución noutro ordenador require o modelo compatible e o runtime nativo. Se o efecto non está dispoñible, comproba a instalación e a compatibilidade de escritorio; se necesitas un resultado renderizado e revisado, usa a [restauración de fala sen conexión](/soundscaper/restore-damaged-speech/). Descargar un modelo non garante que mellore todas as gravacións.
