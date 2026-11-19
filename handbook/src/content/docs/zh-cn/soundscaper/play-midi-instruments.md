---
title: "通过乐器播放 MIDI"
description: "为 MIDI 音符选择合成器，同时保留可编辑的演奏内容。"
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"a602eb1b31f25ec991fc89a9dcdeefe620afcc71915c03f0a6860b87c9efc542","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"a602eb1b31f25ec991fc89a9dcdeefe620afcc71915c03f0a6860b87c9efc542","targetLocale":"zh-CN"} -->

为 MIDI 音符选择合成器，同时保留可编辑的演奏内容。

## 开始之前

打开或导入 MIDI，或在 Soundscaper 中创建新音轨。内置播放选项与可选原生乐器有所不同。原生插件乐器需要桌面应用及相应且已启用的插件。

## 步骤

1. 如果需要音轨，请选择 **音轨 > 添加新音轨 > MIDI track (beta)**。
2. 打开 **窗口 > Piano roll (beta)**。添加音符或选择现有 MIDI 素材。
3. 选择 **Instrument**。使用原生乐器时，打开 **Instrument settings** 调整音色并保存预设。
4. 开始播放，检查音符和延音，然后保存并重新打开项目。

## 检查结果

播放时应听到所选乐器的声音，同时钢琴卷帘中的音符仍可编辑。重新打开项目时，只要所需插件仍已安装，乐器设置和预设就会恢复。

## 限制和恢复

原生乐器适用于 MIDI 音轨，而非普通音频音轨。保存的预设不会包含插件二进制文件或外部库。受支持的桌面安装包默认启用捆绑乐器；其他乐器可能需要使用 [Plugin Manager](/soundscaper/use-desktop-plugins/)。依赖相同音色前，请在目标电脑上检查播放和导出效果。
