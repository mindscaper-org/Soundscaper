---
title: "將已儲存專案當作連結音訊重複使用"
description: "將已儲存專案插入其他編排，並隨時取得後續編輯。"
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"ff1eb7c442461290d4b0b61fc89870619cc8872f4ee2143e65283db0dc1defa9","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"ff1eb7c442461290d4b0b61fc89870619cc8872f4ee2143e65283db0dc1defa9","targetLocale":"zh-TW"} -->

將已儲存專案插入其他編排，並隨時取得後續編輯。

## 開始之前

將子 Soundscaper 專案儲存在同一個本機專案資料庫中。先完成混音。在使用背景子專案算繪器之前，請先將啟用中的原生外掛程式處理算繪並寫入音訊。

## 步驟

1. 開啟父專案並選擇 **檔案 > Subprojects**。
2. 在 **Project to insert or relink** 下選擇子專案，再選擇 **Insert subproject**。已發佈的混音會出現在新音軌上。
3. 選取 **Linked subprojects** 下的連結，再選擇 **Open subproject** 編輯子專案。儲存後回到父專案聆聽更新的音訊。
4. 選擇 **Pin current audio** 保留此版本，或選擇 **Make independent audio** 停止跟隨子專案。

## 檢查結果

子專案更新時，父專案的放置位置會保持不變。更新後播放並檢查開頭與結尾。較短的子專案混音會在原本的發佈範圍內補上靜音。

## 限制與復原

已發佈的時間長度和聲道配置固定不變；若要使用不同範圍，請另外插入一個位置。可攜式父專案檔包含已安裝的音訊，但不包含可編輯的子專案。請另外傳送子專案並使用 **Relink to selected project**。系統會拒絕循環連結。
