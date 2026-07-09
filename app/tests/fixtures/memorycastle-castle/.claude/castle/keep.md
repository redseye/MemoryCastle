# Keep — MemoryCastle

> 常駐載入的核心記憶，也是城堡的大廳——每條路線的第一站。硬預算：本說明區以下 30 行。修改本檔屬黃級（需使用者同意）。上次巡查：2026-07-06。
> 格式：`- [YYYY-MM-DD | conf | src] 一行事實 #tag`——見 MemoryCastle architecture §2。記錄一律繁體中文。

## 身分（這個專案是什麼，最多 3 行）

- [2026-07-06 | conf:high | src:user] MemoryCastle 是建立在記憶宮殿法（method of loci）上的檔案式 AI 記憶框架：房間錨定在專案地形的位置上、路線保證完整回想、城門／巡查／遺忘機制讓記憶可信。#identity
- [2026-07-06 | conf:high | src:user] 策略：方法論先行、SDK（TypeScript）後行；第一宿主是 Claude Code、由作者親自 dogfood；記憶屬於專案（團隊共享）、執行靠模型自律（不用 hook）。#identity

## 約束（每個 session 都必須遵守的事）

- [2026-07-06 | conf:high | src:user] 框架規格與 skill 以英文為權威；城堡實例檔案整份繁體中文（記憶宮殿是給人看的）；對使用者的回覆一律繁體中文。#constraint
- [2026-07-06 | conf:high | src:architecture§8] 方法論階段不用 hook／daemon——自動化是之後版本的選配（architecture §9）且必須成功時靜默（教訓：devteam hook 稅實測吃掉 34-52% context）。#constraint
- [2026-07-06 | conf:high | src:architecture§3] 城堡檔案視同團隊公開、可能進版控：永不寫入機密、token、第三方個資。#constraint

## 核心事實（多數 session 都需要；只能經巡查＋使用者同意晉升到這裡）

- [2026-07-06 | conf:high | src:session] 本專案自舉：它自己的記憶就在 .claude\castle\——把這個實例當參考範本，保持示範品質。#meta
