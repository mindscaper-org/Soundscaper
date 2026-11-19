---
title: "減少對白麥克風之間的串音"
description: "建立可編輯的增益包絡，降低未發言麥克風中相關串音的音量。"
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"5c9e85ea0bae3f0c6489f0b5a3235c11e843612c88fa8c2076a4c00e82937752","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"5c9e85ea0bae3f0c6489f0b5a3235c11e843612c88fa8c2076a4c00e82937752","targetLocale":"zh-TW"} -->

建立可編輯的增益包絡，降低未發言麥克風中相關串音的音量。

## 開始之前

使用兩到八條時間對齊的對白音軌，理想情況下每人使用一支麥克風，且錄音增益相近。選擇一段有效時間範圍，並確認每條所選音軌都有音訊。解除這些音軌的鎖定與凍結狀態。

## 步驟

1. 選取麥克風音軌和要處理的片段。
2. 開啟 **效果器 > 噪音移除與修復 > Automatic microphone-bleed reduction**。
3. 先使用預設設定，再選擇 **Create gain envelopes**。
4. 播放該片段，尤其留意插話和重疊說話的部分。使用 **片段增益** 調整產生的控制點，避免降低應保留的語音。

## 檢查結果

增益控制點會降低串音，同時保留原始來源和片段位置。檢查每位講者開始發言的位置以及所選範圍的邊界。**復原** 會移除操作；**重做** 會重新套用。

## 限制與復原

這項功能不會對齊錄音，也不會分離正在發話的麥克風中的聲音。增益差異很大、混響明顯，或微弱語音位於強烈串音之下時，都可能造成錯誤。若要嘗試其他設定，請先復原第一次套用，否則再次套用會疊加衰減。無法處理頻譜選取範圍、已鎖定音軌或已凍結音軌。
