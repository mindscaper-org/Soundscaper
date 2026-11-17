---
title: "播放时检查声音"
description: "使用 Analysis 面板查看实时频谱、响度、立体声检查结果和 ACX 音频报告。"
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"85b26bbd1bc97b708c3e8e62ddfc80986c24be6c078c7c997c569f88fd918643","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"85b26bbd1bc97b708c3e8e62ddfc80986c24be6c078c7c997c569f88fd918643","targetLocale":"zh-CN"} -->

使用 Analysis 面板查看实时频谱、响度、立体声检查结果和 ACX 音频报告。

## 开始之前

打开含有音频的项目。决定要检查播放内容还是选定范围：时间选区可能会将频谱切换到选区分析。

## 步骤

1. 打开 **分析 > 分析**。展开所需部分，例如 **Spectrum**、频谱图、响度或相关性。
2. 清除时间选区并开始播放，以查看实时数据。在频谱中比较各音轨叠加图，找出相互竞争的频段。
3. 停止播放并选择一段素材，以便在不播放时检查其频谱。
4. 检查有声书时，展开 **ACX compliance** 并选择 **Check audio**。阅读结果表；使用 **导出** 导出 JSON 报告。

## 检查结果

实时显示会随播放变化。ACX 报告会逐项列出音频检查是否通过，而不只是显示一个计量表。修正不合格的电平或格式设置，然后再次检查。

## 限制和恢复

频谱显示的是能量，不能判断混音是否好听。相关性和响度需要结合上下文与实际试听来解读。ACX 音频检查不能保证出版服务会接受作品，也不会检查所有编辑要求。收起 ACX 部分会清除显示的检查结果；需要时请重新运行。关闭不需要的分析器部分，以减少显示工作。
