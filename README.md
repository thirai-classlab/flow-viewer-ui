# 業務フロービューア UI 最適化（flow-viewer-ui）

`~/work/雑務/flow-viewer/`（POC）を引き継ぎ、**UI を最適化する**ためのプロジェクト。
描画エンジンは引き続き **LogicFlow**、真実源は業務フロー JSON。

## 目的

POC で実証済みの「具体⇔抽象を行き来する 3 表示モード」を土台に、
**業務フローを読む人にとって迷わない UI** に仕上げる。
機能追加ではなく、既にある機能の見え方・触り方・情報の出し方を最適化する。

## 背景

- `~/work/雑務/flow-viewer/` は 2026-08-27〜28 に作った POC。
  58 ライブラリの調査（`~/work/雑務/flow-visualization-oss-research/`）→ 11 ライブラリの実機比較 → LogicFlow 採用、までを一気に進めた
- POC は「動くこと」「階層アルゴリズムが壊れないこと」（32 テストケース × 848 通りの総当たり）を優先しており、
  UI はベンチマークアプリのダークテーマ・ツールバー構成をそのまま引き継いでいる
- 一方で POC 段階でも「閲覧モードでフローを主役にする」作り直しは一度やっており、
  その知見（`docs/inherited-findings.md`）を捨てずに次へ進める必要がある
- POC の `src/` を直接いじると比較実験の基準が失われるため、フォルダを分けて凍結する

## やること / 構築物

1. **現状 UI の棚卸し** — `docs/ui-baseline.md`（初期状態のスクショは `docs/baseline/`）
2. **UI 最適化**（このプロジェクトの本体。方針はユーザーと決める）
   - 候補: 情報設計（ツールバー / パンくず / 設定ポップオーバーの整理）、
     配色・タイポグラフィ（ダークテーマの見直し or ライトテーマ追加）、
     ノード・エッジの視覚言語（種別の判別性、例外遷移の強調）、
     パネル類（手順書 DocPanel / JSON SidePanel）の出し方、
     操作の発見性（「潜る」「戻る」「畳む」のアフォーダンス）、レスポンシブ
3. **回帰確認** — 階層アルゴリズム（`src/flow/`）は触らない前提。表示の変更後も
   32 テストケース（編集モード → データ選択）で破綻しないことを目視で確認する

## 利用するスキル

- `frontend-design` / `ui-ux-pro-max` — UI 最適化の設計指針
- `agent-browser` または `claude-in-chrome` — 実機スクショと before / after 比較
- 通常の TypeScript / React 開発（Vite）

## 起動

```bash
npm install
npm run dev        # http://127.0.0.1:5201  （POC の 5200 と同時起動して見比べられる）
npm run typecheck
npm run build
```

## フォルダ構造

```
flow-viewer-ui/
├── README.md                  # 本ファイル（目的・背景・構成）
├── docs/
│   ├── inherited-findings.md  # POC から引き継ぐ知見（UI に効くものを抜粋 + 原典へのリンク）
│   ├── ui-baseline.md         # 現状 UI の棚卸し（改善の起点。before の記録）
│   └── baseline/              # 初期状態のスクリーンショット
├── package.json               # name: flow-viewer-ui / dev port 5201
├── vite.config.ts
├── index.html
└── src/                       # POC の src/ をそのままコピー（2026-08-28 15:18 時点）
    ├── flow/                  # ライブラリ非依存の層（真実源 JSON・階層アルゴリズム・32 テストケース）※原則触らない
    ├── logicflow/             # LogicFlow による描画（layout / drilldown / split / anim / nodes）
    │   └── NOTES.md           # POC の実装ノート（LogicFlow の地雷と回避策）
    ├── ui/                    # シェル UI（Toolbar / SidePanel / DocPanel / JsonPanel / InfoPanel）← 主な改修対象
    ├── styles.css             # ダークテーマ全体 ← 主な改修対象
    └── App.tsx                # 状態の持ち方（閲覧 / 編集モード、3 表示モード）
```

## POC との関係

| | `~/work/雑務/flow-viewer/`（POC） | `flow-viewer-ui/`（本プロジェクト） |
|---|---|---|
| 役割 | ライブラリ選定と階層アルゴリズムの実証 | UI 最適化 |
| 状態 | **凍結**（比較実験の基準として残す） | 開発中 |
| ポート | 5200 | 5201 |
| `src/flow/` | 同一 | 同一（変更しない） |
| `src/ui/` `styles.css` | ベンチマーク由来 | ここを作り直す |

POC 由来の無関係なファイル（`hero*.png` `s1.png` = 別 LP のスクショ）は引き継いでいない。
