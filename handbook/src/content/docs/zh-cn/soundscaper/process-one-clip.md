---
title: "对单个片段应用实时效果"
description: "为单个音频片段设置自己的效果架，而不处理音轨上的所有片段。"
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"0d37cd5c96e28ec54b0e1f2cb991c996e77e1e10a9b8583b806ac616d53a87f2","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"0d37cd5c96e28ec54b0e1f2cb991c996e77e1e10a9b8583b806ac616d53a87f2","targetLocale":"zh-CN"} -->

为单个音频片段设置自己的效果架，而不处理音轨上的所有片段。

## 开始之前

在 Soundscaper 中选择一个音频片段。片段效果属于该片段的处理链，并会进入音轨效果；音轨和主控处理仍可能改变你听到的声音。

## 步骤

1. 打开 **窗口 > 片段属性** 并展开 **效果器**。这是该片段的效果架。
2. 选择 **添加效果器**，选取一个效果并调整设置。播放片段以试听。
3. 使用效果的电源按钮比较旁通和处理后的声音。可按需在效果架中重新排序或移除效果。
4. 保存项目，然后与相邻片段一起试听。如果更改没有帮助，请使用 **撤销**。

## 检查结果

所选片段具有独立处理，其他片段仍保留各自的设置。试听片段结束后的部分，检查混响或延迟尾音；如果混合结果过强，请检查音轨效果架。

## 限制和恢复

效果尾音可能超过片段源音频的长度；交付前请检查导出尾音选项。对于 Auto Duck 检测器，请选择其他合适的音轨；系统会拒绝反馈环路。要让处理器在静音时休眠，请打开效果标题栏中的 **更多选项 > Auto-idle**。对于时间敏感的插件，请禁用此选项。相关设置请参阅[本地处理](/help/local-processing/)。
