# NEULI Live 2.5D v0.3 — Layer Rig

這版把 v0.2 的「整張人物 mesh warp」改成局部分層控制。角色仍是同一張臉，但眼睛、閉眼狀態、嘴唇與前髮使用獨立 WebGL draw pass，因此眨眼／說話不需要把整張臉壓扁或切換成另一個人物。

## 已完成

- Base 人物 mesh：頭部小角度視差 + 呼吸
- 左右眼獨立 layer：視線只在眼睛局部移動
- 左右閉眼 layer：眨眼採交叉淡入，不使用整臉壓縮
- Mouth layer：A / I / U / E / O 形變 + Smile
- Front hair layer：獨立細微擺動
- Browser TTS + viseme 驅動
- SpeechRecognition（瀏覽器支援時）
- 房間 / 夜景 / 咖啡廳場景
- 桌機、平板、手機與 iPhone safe-area layout
- 本機 demo chat API
- PWA cache

## 執行

需要 Node.js 20+：

```bash
npm start
```

開啟 `http://localhost:4173`。

Windows 可使用 `run-local.bat`；macOS 可使用 `run-local.command`。

## Layer authoring

`tools/build_layers.py` 可以由 `public/assets/haneul_cutout.png` 重建眼、嘴、閉眼與前髮素材。這只是作者端工具，網站執行時不需要 Python。

## 目前界線

這仍是 2.5D，不是完整 3D 頭模。安全頭部視差維持在約 ±20° 內；更大角度會暴露單視角素材限制。閉眼 layer 是由同一角色素材建立的局部 layer，不會換成另一張臉，但尚未等同專業 Live2D Cubism 手工切圖與 Deformer 的品質。
