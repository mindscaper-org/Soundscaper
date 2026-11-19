---
title: "比較同一音軌上的替代編輯版本"
description: "為同一音軌保留多種編排，並在版本之間切換。"
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"8c79a03859a4d9d2082884e1a7ea71d11b90b021b834a5e4699f7a01b7a3b029","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"8c79a03859a4d9d2082884e1a7ea71d11b90b021b834a5e4699f7a01b7a3b029","targetLocale":"zh-TW"} -->

為同一音軌保留多種編排，並在版本之間切換。

## 開始之前

在可寫入的 Soundscaper 專案中選取要編輯的音訊軌。播放清單會切換該音軌的素材；若要保留完整編排，請使用[工作階段快照](/soundscaper/save-session-snapshots/)。

## 步驟

1. 開啟 **音軌 > Track playlists**。
2. 輸入 **Playlist name**，然後選擇 **Duplicate current playlist**。在時間軸上編輯目前啟用的副本。若需要空白版本，請改選 **Create empty playlist**。
3. 重新開啟對話框，在 **Playlists** 下選取 **原始**，再選擇 **Activate playlist** 聆聽先前的編輯。
4. 啟用替代版本以便比較。完成後可使用 **Rename playlist**，或刪除未啟用的播放清單。

## 檢查結果

該音軌只會顯示目前啟用的播放清單。**復原** 會復原切換。等待專案儲存後重新開啟，確認兩個命名版本都仍可使用。

## 限制與復原

無法刪除目前啟用的播放清單。未啟用的版本仍參照其音訊，因此會佔用儲存空間。播放清單是同一音軌上的替代方案，不是同時播放的多個圖層；若要一起聆聽，請將素材放在不同音軌。
