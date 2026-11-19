---
title: "从其他编辑器导入音频会话"
description: "导入受支持的音频编辑、重新连接媒体，并了解转换限制。"
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"20d929f85abefccaba62453f8ca9bca18af93a0fc4a37fda4c3ed0084862cb85","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"20d929f85abefccaba62453f8ca9bca18af93a0fc4a37fda4c3ed0084862cb85","targetLocale":"zh-CN"} -->

导入受支持的音频编辑、重新连接媒体，并了解转换限制。

## 开始之前

将会话及其音频复制到可访问的文件夹。支持导入的原生音频会话格式包括 REAPER `.rpp`、Hindenburg `.nhsx`、Pro Tools `.pts`/`.ptf`/`.ptx`、Ardour `.ardour`、SoundCraft 会话，以及 Audition `.sesx` 或旧版 `.ses`。保留原始项目。

## 步骤

1. 选择 **文件 > 已打开** 或 **文件 > 导入**，也可以将会话拖入工作区。
2. 在浏览器中，选择与会话配套的音频。在桌面端，根据提示授予媒体文件夹访问权限。
3. 打开 **文件 > 交付报告**。查看省略和转换的内容，并在需要时重新链接离线媒体。
4. 试听有代表性的编辑和淡变，检查音轨顺序与时间，然后另存为新的 Scape 项目。

## 检查结果

导入的剪辑应与可访问的源音频对齐。将结果与原编辑器的参考混音进行比较，尤其是在处理、路由或自动化会影响声音时。

## 限制和恢复

原生导入是对音频编辑的转换，并不保证混音完全相同。受支持的细节因格式而异；源会话中的插件不会运行。REAPER 会使用当前活动的音频 take，不会导入备用 take 编辑、MIDI、路由或插件。要与其他 DAW 交换项目，请使用受支持的交换格式，例如 AES31 ADL 或 DAWproject，不要期待能够写出原生会话文件。
