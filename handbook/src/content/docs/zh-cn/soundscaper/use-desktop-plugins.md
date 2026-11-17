---
title: "使用桌面音频插件"
description: "在 Soundscaper 桌面版中查找、启用并试听原生效果和乐器。"
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"fc4f375d65049fb921bb3c7a04239407a33132340a7eb14cd5eae22db3092c9e","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"fc4f375d65049fb921bb3c7a04239407a33132340a7eb14cd5eae22db3092c9e","targetLocale":"zh-CN"} -->

在 Soundscaper 桌面版中查找、启用并试听原生效果和乐器。

## 开始之前

安装与操作系统和受支持宿主格式兼容的插件构建。受支持的安装包默认提供捆绑桌面插件；额外插件仍需要扫描发现，并可能需要授予权限。

## 步骤

1. 打开 **效果器 > 插件管理**。搜索列表，并使用 **扫描和设置** 设置扫描选项。
2. 选择插件并查看其版本、权限和恢复控件。适用时启用它。
3. 通过 **效果器 > 音频插件效果** 或实时效果架添加效果。通过 MIDI 音轨的乐器控件选择原生乐器。
4. 试听播放效果；如有需要，保存预设，然后保存项目。

## 检查结果

只要相同的兼容二进制文件可用，目标插件就应处理声音并在重新打开项目时加载已保存设置。交付前旁通插件进行对比并检查导出结果。

## 限制和恢复

Windows 安装包支持维护中的 VST2 桥接路径，包括受支持的 32 位插件。Linux 可通过已安装并配置的 yabridge/Wine 使用 Windows VST3；这不会替你安装或授权第三方插件。插件预设不包含二进制文件。如果插件失败，请使用 Plugin Manager 的恢复控件，并在继续工作前尝试兼容版本。
