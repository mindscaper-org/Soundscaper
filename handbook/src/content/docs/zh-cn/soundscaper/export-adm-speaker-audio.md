---
title: "为扬声器渲染 ADM 节目"
description: "使用 EBU EAR 将制作完成的 ADM 底层声部和对象导出为普通扬声器音频。"
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"5af5c8eeeac85ba578ac51c27f066d77851b7c1a9128257d3b919b71a1c76825","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"5af5c8eeeac85ba578ac51c27f066d77851b7c1a9128257d3b919b71a1c76825","targetLocale":"zh-CN"} -->

使用 EBU EAR 将制作完成的 ADM 底层声部和对象导出为普通扬声器音频。

## 开始之前

在 Metadata editor 的 ADM 标签页中制作 ADM 节目，设置底层声部分配并放置对象。了解交付扬声器布局，并选择能够容纳所需声道数的容器和编解码器。

## 步骤

1. 打开 **文件 > 导出音频**。
2. 在 **渲染 > EBU EAR speaker rendering** 下选择布局：stereo、5.1、5.1.2、5.1.4、7.1 或 7.1.4。
3. 检查输出格式、声道数和电平设置，然后导出。
4. 阅读交付报告，并通过相应的扬声器布局试听导出文件。

## 检查结果

输出内容是按照声明的声道顺序渲染的扬声器 PCM。此导出选项不会更改项目监听或原始 ADM 制作内容。查看报告，确认使用的渲染器和布局。

## 限制和恢复

EAR 扬声器渲染不能与耳机渲染组合。分离输出和 BW64/ADM 直通不能使用此选项。渲染后的声道不包含原始 bed/object ADM 元数据；如需交换该类信息，请使用未渲染的 BW64。移动或弥散对象、HOA、低音管理以及经过认证的 Dolby 渲染不属于此功能范围。普通响度计最多支持八个交付声道。
