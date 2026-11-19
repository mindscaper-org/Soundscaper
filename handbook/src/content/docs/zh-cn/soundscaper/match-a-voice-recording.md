---
title: "匹配人声录音的音色"
description: "学习音色参考，并使用 Match EQ 让另一段录音更接近它。"
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"2b6667d165ad26e0b7420dc98e595da9045ad4ca45fdda417a37a2d3e697c0e4","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"2b6667d165ad26e0b7420dc98e595da9045ad4ca45fdda417a37a2d3e697c0e4","targetLocale":"zh-CN"} -->

学习音色参考，并使用 Match EQ 让另一段录音更接近它。

## 开始之前

选择一段清晰可听、至少四分之一秒且具有完整频段的参考音频，最好是同一位说话者录制良好的音频。准备好目标录音。此功能在浏览器和桌面端均使用本地处理。

## 步骤

1. 选择参考音频并打开 **效果器 > 均衡器和滤波器 > Match EQ**。选择 **Learn reference from selection**。
2. 如果想重复使用此声音配置，请将学习到的参考另存为预设。关闭对话框。
3. 选择目标音频，重新打开 Match EQ，必要时调出参考，然后选择 **Analyze target**。
4. 使用 **预览** 比较 **原始** 和 **Matched (level compensated)**。调整校正量，然后选择 **应用到选区**；也可以选择 **Edit as Filter Curve EQ** 编辑曲线。

## 检查结果

在相近响度下试听，检查音色平衡是否更接近。处理后的音频会保留原有时长和声道数。**撤销** 会撤销应用操作。

## 限制和恢复

Match EQ 无法恢复缺失的频宽，也不能匹配表演、动态、房间混响或声音身份。采集参考时包含总线和主控之前的音轨效果；分析目标时则位于其音轨效果架之前。如果所需参考声音取决于下游处理，请先渲染参考音频。
