---
title: "减少对白麦克风之间的串音"
description: "创建可编辑的增益包络，降低未发言麦克风中相关串音的音量。"
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"5c9e85ea0bae3f0c6489f0b5a3235c11e843612c88fa8c2076a4c00e82937752","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"5c9e85ea0bae3f0c6489f0b5a3235c11e843612c88fa8c2076a4c00e82937752","targetLocale":"zh-CN"} -->

创建可编辑的增益包络，降低未发言麦克风中相关串音的音量。

## 开始之前

使用两到八条时间对齐的对白音轨，理想情况下每人使用一个麦克风，且录音增益相近。选择一段有效时间范围，并确保每条所选音轨都有音频。解锁并解冻这些音轨。

## 步骤

1. 选择麦克风音轨和要处理的片段。
2. 打开 **效果器 > 噪声消除与修复 > Automatic microphone-bleed reduction**。
3. 先使用默认设置，然后选择 **Create gain envelopes**。
4. 播放该片段，尤其留意插话和说话重叠的部分。使用 **片段增益** 调整生成的点，避免降低需要保留的语音。

## 检查结果

增益点会降低串音，同时保留原始音源和片段位置。检查每位说话者的开口处和所选范围边界。**撤销** 会移除操作；**重做** 会重新应用。

## 限制和恢复

此功能不会对齐录音，也不会分离正在发言的麦克风中的多个人声。较大的增益差异、混响以及被强串音掩盖的轻声讲话都可能导致错误。尝试其他设置前，请撤销第一次应用；再次应用会叠加衰减。频谱选区、已锁定音轨和冻结音轨无法处理。
