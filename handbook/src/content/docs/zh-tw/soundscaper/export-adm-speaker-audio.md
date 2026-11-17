---
title: "為喇叭算繪 ADM 節目"
description: "使用 EBU EAR 將製作完成的 ADM bed 和 object 匯出為一般喇叭音訊。"
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"5af5c8eeeac85ba578ac51c27f066d77851b7c1a9128257d3b919b71a1c76825","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"5af5c8eeeac85ba578ac51c27f066d77851b7c1a9128257d3b919b71a1c76825","targetLocale":"zh-TW"} -->

使用 EBU EAR 將製作完成的 ADM bed 和 object 匯出為一般喇叭音訊。

## 開始之前

在 Metadata editor 的 ADM 索引標籤中製作 ADM 節目，並指派 bed、定位 object。確認交付用的喇叭配置，選擇能容納所需聲道數的容器和編碼器。

## 步驟

1. 開啟 **檔案 > 匯出音訊**。
2. 在 **渲染 > EBU EAR speaker rendering** 下選擇配置：stereo、5.1、5.1.2、5.1.4、7.1 或 7.1.4。
3. 檢查輸出格式、聲道數和音量設定，再匯出。
4. 閱讀交付報告，並透過相符的喇叭配置試聽匯出的檔案。

## 檢查結果

輸出內容是依照宣告的聲道順序算繪的喇叭 PCM。這個匯出選項不會改變專案監聽或原始 ADM 編排。檢查報告中使用的算繪器和配置。

## 限制與復原

EAR 喇叭算繪和耳機算繪無法合併。分割輸出與 BW64/ADM 直通無法使用此選項。算繪後的聲道不包含原始 bed/object ADM 中繼資料；若要交換這些內容，請使用未算繪的 BW64。移動或擴散物件、HOA、低音管理及認證 Dolby 算繪不在此功能範圍內。一般響度表最多支援八個交付聲道。
