---
title: "从损坏的 Audacity 项目中恢复音频"
description: "评估损坏的项目，并将恢复的内容另存为独立副本。"
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"f4aa18a820f00d839f2a3c2eb08f911c2444e199d6e4fa8e842b5922a215bcd6","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"f4aa18a820f00d839f2a3c2eb08f911c2444e199d6e4fa8e842b5922a215bcd6","targetLocale":"zh-CN"} -->

评估损坏的项目，并将恢复的内容另存为独立副本。

## 开始之前

先复制损坏的 Audacity 项目。将可用的旁侧文件放在一起。恢复功能可处理受支持的 `.aup3` 和 Audacity 未保存项目文件，但无法重新生成已不存在的采样数据。

## 步骤

1. 打开 **文件 > 项目管理 > 恢复 Audacity 项目**。
2. 选择损坏的项目。在导入或保存任何内容前阅读 **Recovery assessment**。
3. 检查 **Missing audio ranges**，包括后续页面中列出的受影响位置。
4. 如果有 **Save repaired Audacity copy**，请选择它。否则打开恢复结果，查看兼容性报告，再使用新名称保存。

## 检查结果

播放恢复片段，并根据报告检查空隙或静音。在依赖新副本之前，确认它能够正常打开。保留原始损坏文件，以便再次尝试恢复。

## 限制和恢复

恢复可能会保留有效的音频前缀，并将缺失采样替换为静音。修复后的数据库并不表示所有音频都已恢复，也不表示所有原生编辑功能都可迁移。阅读报告中的省略项，诊断时绝不要覆盖唯一的原件。对于完整的普通项目，请使用 [Audacity 导入指南](/guides/projects/open-an-audacity-project/)。
