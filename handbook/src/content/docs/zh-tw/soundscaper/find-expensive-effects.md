---
title: "找出耗用播放 CPU 的效果"
description: "簡化處理之前，先比較即時效果的運算成本。"
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"06fac5e13d2af31e85494e4a5e5b9fa26ae67584fd3365c795c95d63d93a255d","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"06fac5e13d2af31e85494e4a5e5b9fa26ae67584fd3365c795c95d63d93a255d","targetLocale":"zh-TW"} -->

簡化處理之前，先比較即時效果的運算成本。

## 開始之前

使用包含即時效果及具代表性繁忙片段的專案。測量結果只反映這台裝置與目前工作負載，不是各種外掛程式的通用排名。

## 步驟

1. 開啟 **幫助 > CPU profiling**。
2. 開啟面板後開始或重新開始播放，讓每個即時效果都能接受測量。
3. 觀察幾次更新。將效果列與基本編輯器列比較；略過一個耗用較高的效果，再播放相同片段。
4. 完成後關閉面板，並還原要保留的處理。

## 檢查結果

CPU 使用量可能超過單一核心的容量：100% 表示一個 CPU 核心完全忙碌。比較 CPU 使用率與已耗用處理時間的百分比。破折號代表沒有可用測量值，不代表零成本。

## 限制與復原

已耗用處理時間包含排程延遲。GPU 使用量和外部輔助程序不會列入，而且分析本身也會增加負擔。略過的效果會個別標示。若要讓合適的處理器在靜音時休眠，請開啟效果標題列中的 **更多選項 > Auto-idle**。需要持續計時的效果則應停用此選項。相關設定請參閱[本機處理](/help/local-processing/)。比較變更時，務必重新播放相同片段。
