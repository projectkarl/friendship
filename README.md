# NEULI v0.4 — Real Avatar Asset Build

這一版不再以圖片或 CSS 人臉冒充 Avatar。專案內含可實際被 Three.js 載入的 `public/assets/haneul.glb`，以及可重建該模型的 Python 產生器。

## 已實作

- `haneul.glb` 真 3D mesh 資產
- 51,836 triangles / 17 meshes / 26 nodes
- 9-joint skeleton：Hips / Spine / Chest / Neck / Head / shoulders / upper arms
- 獨立眼白、虹膜、瞳孔
- Hair cap + 多片 hair cards
- 嵌入式 PNG 皮膚貼圖，來源為本專案先前生成的 Haneul 虛構成人角色參考圖
- facial morph targets：`Blink`, `Smile`, `A`, `I`, `U`, `E`, `O`
- Three.js GLB 載入與 `@pixiv/three-vrm` VRM override 支援
- 模型 QA 面板：實際顯示 mesh / triangles / bones / facial target 完整性
- 頭部、頸部、胸腔 idle 動作
- 視線追蹤與虹膜位移
- 自動 blink
- smile / mood
- Neural TTS 音訊振幅驅動
- 可選 TTS viseme 時間碼，直接驅動 A/I/U/E/O
- 沒有 viseme 時間碼時，使用文字音節 + 音量 fallback
- 6 組衣服材質切換
- 原聊天、語音輸入、Cloudflare Functions、PWA 保留

## 不是什麼

這個 GLB 是**單張生成角色參考圖的真 3D 重建 base**，不是把照片貼成 billboard；但它也不是攝影測量、3D 掃描或人工雕刻完成的電影級角色。正面外觀以 Haneul 參考臉為依據，側面與頭後方是程序建模補完。

若要做到「任何角度都近乎參考圖本人」的最終高模，仍應以多視角參考圖／人工 sculpt／角色建模流程取代目前 head mesh；網頁端的骨架、morph、語音、QA 與控制器不需要重寫。

## 模型檔

- 正式預設：`public/assets/haneul.glb`
- 可選覆蓋：`public/assets/haneul.vrm`
- 規格：`public/assets/avatar-manifest.json`
- 單視角重建工具：`tools/build_haneul_glb.py`
- 模型驗證：`tools/validate_haneul_glb.py`
- 原始角色參考：`tools/reference/haneul_reference.png`

重建：

```bash
python tools/build_haneul_glb.py
python tools/validate_haneul_glb.py
```

## 真實嘴型 / TTS

`/api/tts` 支援兩種上游格式。

### 1. 純音訊

上游直接回 `audio/mpeg` / `audio/wav`。Avatar 使用實際音訊分析 + 文字音節估算嘴型。

### 2. 音訊 + viseme（建議）

上游回：

```json
{
  "audioBase64": "...",
  "mimeType": "audio/mpeg",
  "visemes": [
    {"t": 0.08, "v": "A", "w": 0.85},
    {"t": 0.19, "v": "I", "w": 0.72}
  ]
}
```

`t` 為音訊起始後的秒數。`v` 可使用 A / I / U / E / O。這種模式的嘴型同步會比單純依音量開合自然許多。

Cloudflare 環境變數：

- `TTS_ENDPOINT`
- `TTS_API_KEY`
- `TTS_VOICE`（選填）
- `AI_ENDPOINT`
- `AI_API_KEY`
- `AI_MODEL`

沒有 Neural TTS 時，仍會 fallback 到瀏覽器 Speech Synthesis；這可以用，但不等同於正式神經女聲品質。

## Cloudflare Pages

維持原本 Pages + Functions 結構：

- Output directory：`public`
- `functions/` 由 Pages Functions 部署
- 無額外前端 build command

## QA

詳見 `TEST_REPORT.md` 與 `MODEL_QA.json`。
