---
title: "导出包含效果尾音的循环"
description: "将混响或延迟尾音折叠到循环音频文件的开头。"
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"70ee9977385574f17d5b85641f92c402e911407d0a4c2cb62ccbd14f4d1a6e15","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"70ee9977385574f17d5b85641f92c402e911407d0a4c2cb62ccbd14f4d1a6e15","targetLocale":"zh-CN"} -->

将混响或延迟尾音折叠到循环音频文件的开头。

## 开始之前

准备一个经过所需处理的精确循环范围。检查连接处时使用 WAV 等无损格式。确保常规播放和导出电平不会削波。

## 步骤

1. 选择需要循环播放的时间范围，并打开 **文件 > 导出音频**。
2. 选择所选范围以及适当的格式、采样率和声道布局。
3. 在导出设置中启用 **Render as loop**。导出文件。
4. 将结果导入测试项目并试听多次循环，尤其留意边界处。

## 检查结果

导出文件保持所选循环时长，渲染后的尾音会绕回开头。检查是否有咔嗒声、电平突增，并确认混响过渡平滑。

## 限制和恢复

尾音折叠无法修复不合适的音乐剪切点或不连续的干声波形。它不同于 **包含长达 10 秒的效果器拖尾**，后者会延长常规导出。叠加尾音可能抬高峰值；请降低电平或使用 Limiter 的可选真峰值限制，然后检查交付文件。有损格式可能引入填充或改变峰值，因此也要验证实际交付格式。
