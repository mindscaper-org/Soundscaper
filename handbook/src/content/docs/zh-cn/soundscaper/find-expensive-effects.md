---
title: "查找占用播放 CPU 的效果"
description: "比较实时效果的成本，再决定要简化哪些处理。"
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"06fac5e13d2af31e85494e4a5e5b9fa26ae67584fd3365c795c95d63d93a255d","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"06fac5e13d2af31e85494e4a5e5b9fa26ae67584fd3365c795c95d63d93a255d","targetLocale":"zh-CN"} -->

比较实时效果的成本，再决定要简化哪些处理。

## 开始之前

使用包含实时效果且有代表性繁忙片段的项目。测量结果仅描述当前设备和工作负载，并非对插件的通用排名。

## 步骤

1. 打开 **帮助 > CPU profiling**。
2. 打开面板后开始或重新开始播放，以便测量每个实时效果。
3. 观察几次更新。将效果行与基本编辑器行进行比较；旁通一个开销较大的效果，然后重播相同片段。
4. 完成后关闭面板，并恢复要保留的处理。

## 检查结果

CPU 使用量可能超过单核容量：100% 表示一个 CPU 核心完全占用。比较 CPU 和已用处理时间的百分比。短横线表示没有可用测量值，不代表零开销。

## 限制和恢复

已用处理时间包含调度延迟。GPU 使用量和外部辅助进程不计入，性能分析本身也会增加开销。已旁通的效果会单独标识。要让合适的处理器在静音时休眠，请打开效果标题栏中的 **更多选项 > Auto-idle**。对于需要持续计时的效果，请禁用此选项。相关设置请参阅[本地处理](/help/local-processing/)。比较变更时，务必重播同一片段。
