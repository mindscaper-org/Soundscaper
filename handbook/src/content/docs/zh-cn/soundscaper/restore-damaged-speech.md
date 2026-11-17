---
title: "使用本地模型修复受损语音"
description: "应用到录音之前，先检查可选的语音修复结果。"
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"b0f7979f2aaa38569448b78505dc88a35b1ac2411af570ba9f9d78e7dd80e3e8","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"b0f7979f2aaa38569448b78505dc88a35b1ac2411af570ba9f9d78e7dd80e3e8","targetLocale":"zh-CN"} -->

应用到录音之前，先检查可选的语音修复结果。

## 开始之前

使用桌面应用并选择要修复的语音。保留原始音频或快照。任务中显示的模型取决于已发布的目录和已安装的运行时；当前版本可能不提供 VoiceFixer。

## 步骤

1. 打开 **效果器 > 噪声消除与修复 > 增强对话**。
2. 选择兼容的 **模型**。如果提供 **VoiceFixer**，它用于修复语音削波等问题；如有需要，请通过模型控件明确安装。
3. 运行任务，然后选择 **查看结果**，将建议音频与原始音频一同试听。
4. 只有在语音有所改善时才接受建议。应用前检查选定的位置，然后保存项目。

## 检查结果

留意修复后的峰值和更清晰的语音，同时检查元音、呼吸声和背景音是否发生变化。接受的结果会成为可试听和撤销的音频编辑；拒绝或关闭审核不会应用它。

## 限制和恢复

VoiceFixer 会重新合成语音，因此可能改变音色和背景内容。它不是通用音乐削波修复工具。如果模型选择器中没有它，请使用当前提供的增强器，或参阅[修复削波峰值指南](/guides/cleaning-up/restore-clipped-peaks/)；仅按照这些步骤无法启用未提供的模型。
