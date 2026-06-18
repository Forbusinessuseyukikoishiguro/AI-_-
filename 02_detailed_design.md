# うさうさ読書手帖 詳細設計書（v8.0）

🐰 うさうさ研修工房

---

## 1. アーキテクチャ概要

単一HTMLの中に「構造（HTML）」「見た目（CSS）」「振る舞い（inline JS）」を同居させた、フレームワーク非依存の構成。状態は `localStorage`、描画は素のDOM操作。レイヤは概念的に次の通り。

```
┌─────────────────────────────────────────┐
│ UI（DOM要素 / イベントハンドラ）          │
├─────────────────────────────────────────┤
│ ドメインロジック                          │
│  ・状態管理 state / load / save           │
│  ・週次桜 weekDone / weekBare / renderWeek │
│  ・自動リセット nextSundayReset / scheduler│
│  ・書きかけ InputDraft                     │
├─────────────────────────────────────────┤
│ 基盤                                       │
│  ・Store（localStorage＋メモリ退避）       │
│  ・Logger（エラーログ／永続化）            │
└─────────────────────────────────────────┘
```

設計方針：**基盤（Store / Logger）はドメインに依存しない**。Logger は Store にも依存させず、自前で `localStorage` を直接触る（循環回避＋ストレージ障害時も最低限動く）。

---

## 2. モジュール設計

### 2.1 Store（永続化基盤）
- 役割：`localStorage` への読み書きを安全に行う。失敗時はメモリへ退避し、ログに残す。
- API：`get(key,def)` / `set(key,val)→boolean` / `remove(key)` / `available()`
- 仕様：
  - 初期化時に書き込みテストを行い、可否フラグ `ok` を決定。
  - `set` が例外を投げたら `ok=false` に落とし、以降はメモリ（`mem`）を使用。`false` を返す。
  - 空になったキーは `null` を書かず `remove` で完全削除（`"null"` 文字列の残留を防ぐ）。

### 2.2 Logger（エラーログ）
- 役割：例外・保存失敗を時刻つきで記録し、画面と `localStorage` の両方に残す。
- API：`error(ctx,err)` / `warn(ctx,msg)` / `info(ctx,msg)` / `clear()` / `render()` / `entries()`
- 仕様：
  - 最大50件。古いものから破棄。`usausa_techo_errlog_v1` に永続化。
  - 1件以上でパネル（`#errlog`）を自動表示。起動時に過去ログがあれば開いて見せる。
  - `window.error` / `unhandledrejection` をグローバル捕捉。

```js
window.addEventListener("error", function(ev){
  Logger.error("window.onerror", (ev.message||"")+(ev.filename?(" @"+ev.filename+":"+ev.lineno+":"+ev.colno):""));
});
window.addEventListener("unhandledrejection", function(ev){
  var r=ev.reason; Logger.error("unhandledrejection", r&&r.stack?(r.message+"\n"+r.stack):(r&&r.message?r.message:r));
});
```

### 2.3 状態管理（state / load / save）
- `state` を単一の真実とし、`load()` で復元、`save()` で永続化。
- `save` は後段で自動保存トリガにラップされる（デバウンス5秒）。

### 2.4 週次の桜（weekDone / weekBare / renderWeek）
- `weekDone:boolean[7]`（日〜土）＝各日の達成。
- `weekBare:boolean` ＝リセット後の「閉じた状態」フラグ。
- 描画ルール：`done`→🌸 / `bare && !done`→閉じた空きマス（`closed`）/ それ以外→🪷つぼみ。
- `toggleWeekDay(i)`：押下でトグル。未達→達成で和菓子・継続を更新。
- 週が変わる（`weekStart` 不一致）と `weekDone` を初期化し `weekBare=false`。

### 2.5 自動リセット（単一の真実）
- 中核は純粋関数 `nextSundayReset(now)`。ms算出・表示ラベル・タイマー標的のすべてがこれを参照。

```js
function nextSundayReset(now){
  now = now || new Date();
  var target = new Date(now.getFullYear(), now.getMonth(), now.getDate(),
                        WEEK_RESET_HOUR, WEEK_RESET_MIN, WEEK_RESET_SEC, 0);
  var add = (7 - now.getDay()) % 7;        // 日曜なら0
  target.setDate(target.getDate() + add);
  if(target.getTime() <= now.getTime()){ target.setDate(target.getDate() + 7); }
  return target;                            // 常に日曜23:59:59
}
```

- `scheduleWeekAutoReset()`：標的時刻 `_weekResetTarget` を保持し、`setTimeout` で発火→`resetWeekDone`→再スケジュール。
- `checkMissedWeekReset()`：`visibilitychange(visible)` / `focus` で、標的を過ぎていれば実行。スリープ等の取りこぼしを救済。

### 2.6 書きかけ入力（InputDraft）
- 対象：`bookTitle, goalNum, goalUnit, nTitle, nDef, nMeta, nDetail, nSum`
- 保存契機：`input`（600msデバウンス）/ `change` / `beforeunload` / `visibilitychange(hidden)`
- 復元：起動時 `restore()` で各欄へ流し込み、件数>0でトースト通知。
- クリア：`clearNote()`（手帖項目）/ `clearReading()`（読書項目）/ `clearAll()`。全欄が空になったら `Store.remove` でキー削除。

### 2.7 一時保存・MD出力
- 状態の手動保存（メモ付き）／自動保存（30秒間隔＋可視性変化）／選択復元。
- Markdown出力：称号・週・手帖一覧を整形してBlobダウンロード。

---

## 3. 主要処理フロー

### 3.1 書きかけ保存→タブ閉じ→復元
```
入力 → (debounce) → InputDraft.persist → Store.set(usausa_techo_input_v1)
↓ タブを閉じる（localStorageは残る）
再起動 → InputDraft.restore → 各input/textareaへ反映 → トースト「復元しました」
```

### 3.2 桜リセット
```
weekResetBtn → resetWeekDone(false)
  weekDone[*]=false; weekBare=true; save(); renderWeek()
  → 全マスが closed（つぼみ非表示の空きマス）
```

### 3.3 週次自動リセット
```
起動 → scheduleWeekAutoReset → _weekResetTarget=nextSundayReset()
  → setTimeout(fire, ms)
fire → resetWeekDone(false) → 再スケジュール
復帰(visible/focus) → checkMissedWeekReset → 過ぎていれば fire
```

---

## 4. 画面要素（主なID）

| ID | 用途 |
|----|------|
| `week` / `weekNote` / `weekResetBtn` / `weekAutoResetInfo` | 週次桜・リセット・次回予定 |
| `bookTitle` / `goalNum` / `goalUnit` / `finishBtn` / `readState` | 今日の読書 |
| `nTitle` / `nDef` / `nMeta` / `nDetail` / `nSum` / `noteSaveBtn` / `noteClearBtn` | 学びの手帖 |
| `inputDraftStatus` | 書きかけ自動保存ステータス |
| `errlog` / `errlogBody` / `errlogCount` / `errlogToggleBtn` / `errlogCopyBtn` / `errlogClearBtn` / `errlogTestBtn` | エラーログ |
| `saveDraftBtn` / `loadDraftBtn` / `mdDownBtn` / `draftStatus` | 一時保存・復元・MD出力 |
| `resetBtn` / `autoEraseSwitch` / `cafeSwitch` | 全消去・自動消去・カフェモード |

---

## 5. エラーハンドリング方針

- ストレージ操作は必ず try/catch。失敗は握りつぶさず `Logger` に記録。
- 初期化・書きかけ初期化など要所は try/catch で囲み、片側が落ちても全体停止を避ける。
- ユーザー破壊操作（全消去・一括削除・自動消去ON）は `confirm` で確認。

---

## 6. 設計判断・既知の制約

- **weekBare を別フラグにした理由**：`weekDone` を三値化すると保存データ・MD出力・各処理に波及するため、boolean を1つ足す最小変更を選択。
- **時刻関数を1本化した理由**：ms算出と表示で別計算だと将来ズレるため、`nextSundayReset` を単一の真実に。
- **JST前提**：ローカル時刻ベース。DSTのある地域では境界時刻が1時間ずれる可能性がある（現状スコープ外）。
- **永続化の限界**：端末ローカルのみ。ストレージ削除で消える。バックアップはMarkdown手動出力に依存。

> 🐰 うさうさ研修工房 ｜ ver 8.0
