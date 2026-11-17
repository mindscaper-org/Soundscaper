---
title: "對單一片段套用即時效果"
description: "為單一音訊片段設定專屬效果架，而不處理音軌上的所有片段。"
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"0d37cd5c96e28ec54b0e1f2cb991c996e77e1e10a9b8583b806ac616d53a87f2","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"0d37cd5c96e28ec54b0e1f2cb991c996e77e1e10a9b8583b806ac616d53a87f2","targetLocale":"zh-TW"} -->

為單一音訊片段設定專屬效果架，而不處理音軌上的所有片段。

## 開始之前

在 Soundscaper 中選取音訊片段。片段效果屬於該片段的處理流程，並會輸入音軌效果；音軌與主控處理仍可能改變你聽到的聲音。

## 步驟

1. 開啟 **視窗 > 片段屬性** 並展開 **效果器**。這是片段的效果架。
2. 選擇 **加入效果器**，挑選效果並調整設定。播放片段以試聽。
3. 使用效果的電源按鈕，比較略過與處理後的聲音。視需要在效果架中重新排序或移除效果。
4. 儲存專案，再和鄰近片段一起試聽。如果變更沒有幫助，請使用 **復原**。

## 檢查結果

所選片段會有自己的處理設定，其他片段則保留各自的設定。聆聽片段結尾之後的部分，檢查混響或延遲尾音；如果合併後的效果太強，請檢查音軌效果架。

## 限制與復原

效果尾音可能比片段來源音訊更長；交付前請檢查匯出尾音選項。對於 Auto Duck 偵測器，請選擇另一個合適的音軌；系統會拒絕回授迴路。若要讓處理器在靜音時休眠，請開啟效果標題列中的 **更多選項 > Auto-idle**。對於時間敏感的外掛程式，請停用此選項。相關設定請參閱[本機處理](/help/local-processing/)。
