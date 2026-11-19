---
title: "将录制的音符转换为可编辑 MIDI"
description: "使用 Basic Pitch 分析音乐录音，并在保留音频的同时生成可编辑音符。"
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"181c19e5cd65ab9072edb6fd6211bd2006656197182553009771a0e0f4262552","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"181c19e5cd65ab9072edb6fd6211bd2006656197182553009771a0e0f4262552","targetLocale":"zh-CN"} -->

使用 Basic Pitch 分析音乐录音，并在保留音频的同时生成可编辑音符。

## 开始之前

在 Soundscaper 桌面版中安装已发布的 Basic Pitch 模型和匹配的运行时。先选取一段短小、音高清晰的音乐。保留音频作为试听参考。

## 步骤

1. 选择音乐音频并打开 **工具 > 高级本地处理**。
2. 将 **操作** 设为 **Audio to MIDI (Basic Pitch)**。确认所需的本地处理许可，然后选择 **分析**。
3. 选择 **查看结果**，检查检测到的音符，准备好后选择 **接受建议**。
4. 打开 **窗口 > Piano roll (beta)**，选择新 MIDI 素材，并修正音高、时间和音符长度。

## 检查结果

新的 MIDI 音轨会出现在原始音频旁边。选择乐器并与录音一起试听。**撤销** 会移除已接受的建议，但不会删除源音频。

## 限制和恢复

检测出的音符只是估算值，在密集混音或嘈杂录音中尤其如此。MIDI 记录的是音符，而不是原始音色。使用 [MIDI 乐器](/soundscaper/play-midi-instruments/)播放，并使用 **文件 > 导出其他 > Export MIDI (beta)** 分享音符。接收者仍需要能重现目标声音的乐器。
