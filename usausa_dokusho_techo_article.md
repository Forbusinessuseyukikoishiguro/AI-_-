# うさうさ読書手帖をつくる ── 単一HTMLで「書きかけ保存・エラーログ・週次自動リセット」を実装してjsdomで商用テストする

> オフライン単体HTML（vanilla JS・フレームワーク非依存）で読書記録ツールをつくった記録です。
> 「書きかけが消えない」「壊れてもログが残る」「毎週日曜23:59にリセットされる」を、どう実装してどう検証したかをエンジニア向けにまとめます。
> 🐰 うさうさ研修工房

---

## このツールは何か

`usausa_dokusho_techo_v8.html` という**1ファイル完結のHTML**です。サーバ不要、ビルド不要、外部CDN依存なし。ダブルクリックで開けば動きます。

- 読書週間の「桜の枝」（7日分のつぼみ🪷を咲かせる🌸）
- 朝の一服・今日の読書・学びの手帖（定義→たとえ→詳細→一言まとめの四段階）
- ごほうびの和菓子棚 / 称号 / 継続日数
- **書きかけ入力の自動保存**（タブを閉じても残る）
- **エラーログ**（画面表示＋永続化）
- 状態の一時保存／復元、Markdown出力

データは全部 `localStorage`。状態管理ライブラリもビルドツールも使いません。「単一ファイル・オフラインファースト」を工房の標準にしているので、その制約の中でどこまで実用的にできるかが今回のテーマです。

---

## 使い方

| 操作 | 何が起きるか |
|------|--------------|
| 週の🪷を押す | その日が咲く🌸／和菓子+1／継続+1 |
| 「今日の頁をひらく」 | 朝の一行が出る（1日1回） |
| 「読み終えた 🍵」 | 当日を咲かせ、本タイトル等の書きかけを消す |
| 「手帖に綴じる 📌」 | 四段階メモを1枚保存し、入力欄と下書きをクリア |
| 「今週の桜をリセット 🌿」 | つぼみを全消し＝**閉じた状態**にする |
| 🩺「ログ」 | エラーログの表示/非表示 |
| 💾/📂/📄 | 一時保存／復元／Markdown出力 |

ポイントは2つ。

1. **書きかけは勝手に残る。** 本のタイトルや四段階メモを書いている途中でタブを閉じても、次に開くと「書きかけの入力を復元しました ✍️」で戻ります。明示的に保存ボタンを押す必要はありません。
2. **不具合が起きたらログが残る。** 例外や保存失敗はツールバーの🩺「ログ」に時刻つきで蓄積され、タブを閉じても消えません。サポート依頼時はこれを貼るだけで状況が伝わります。

---

## 実装のポイント

### 1. 壊れない保存層（`Store`）

`localStorage` は容量超過・プライベートモード・無効化などで普通に例外を投げます。投げられたら**メモリに退避して継続**し、かつ**ログに残す**。これだけで「入力が一瞬で消える」事故をかなり防げます。

```js
var Store = (function(){
  var mem = {}, ok = false;
  try{ var k="__usa_test__"; localStorage.setItem(k,"1"); localStorage.removeItem(k); ok=true; }
  catch(e){ ok=false; Logger.warn("Store","localStorageが使えないためメモリ保存に切替えます: "+(e&&e.message)); }
  return {
    get:function(key,def){
      try{ if(ok){ var v=localStorage.getItem(key); return v===null?def:JSON.parse(v); } }
      catch(e){ Logger.error("Store.get("+key+")", e); }
      return (key in mem)?mem[key]:def;
    },
    set:function(key,val){
      try{ if(ok){ localStorage.setItem(key,JSON.stringify(val)); return true; } }
      catch(e){ Logger.error("Store.set("+key+")", e); ok=false; } // 失敗以降はメモリへ
      mem[key]=val; return false;
    },
    remove:function(key){
      try{ if(ok){ localStorage.removeItem(key); } }catch(e){ Logger.error("Store.remove("+key+")", e); }
      delete mem[key];
    }
  };
})();
```

`set` が `false` を返したら「ディスクには書けなかったがメモリには載っている」状態。`remove` を持たせて、空になった下書きキーは `null` を書くのではなく**完全に消す**（`"null"` 文字列が残るのを避ける）のも地味だけど大事。

### 2. 書きかけ入力の自動保存（`InputDraft`）

状態（綴じ済みの手帖）とは別に、**入力中の生テキスト**を専用キーに保存します。`input` で600msデバウンス、`change`/`beforeunload`/`visibilitychange(hidden)` で即時保存。`localStorage` なのでタブを閉じても残ります。

```js
var INPUT_FIELDS = ["bookTitle","goalNum","goalUnit","nTitle","nDef","nMeta","nDetail","nSum"];

var InputDraft = (function(){
  var timer=null;
  function collect(){ var o={}; INPUT_FIELDS.forEach(function(id){ var el=$(id); if(el) o[id]=el.value; }); o._savedAt=Date.now(); return o; }
  function persist(){ Store.set(INPUT_DRAFT_KEY, collect()); updateInputDraftStatus(); }
  function scheduleSave(){ clearTimeout(timer); timer=setTimeout(persist, 600); }
  function restore(){
    var d=Store.get(INPUT_DRAFT_KEY,null); if(!d) return 0;
    var n=0; INPUT_FIELDS.forEach(function(id){ var el=$(id);
      if(el && typeof d[id]==="string" && d[id]!==""){ el.value=d[id]; if(id!=="goalUnit") n++; } });
    return n;
  }
  function bind(){ INPUT_FIELDS.forEach(function(id){ var el=$(id); if(!el) return;
    if(el.tagName==="SELECT"){ el.addEventListener("change", persist); }
    else { el.addEventListener("input", scheduleSave); el.addEventListener("change", persist); } });
    window.addEventListener("beforeunload", persist);
    document.addEventListener("visibilitychange", function(){ if(document.visibilityState==="hidden") persist(); });
  }
  return { bind:bind, restore:restore, persist:persist,
    clearNote:function(){ /* 手帖項目だけ消す */ }, clearReading:function(){ /* 読書項目だけ消す */ } };
})();
```

綴じる・読了・「入力を消す」のタイミングで該当項目だけクリアし、全項目が空になったら `Store.remove` でキーごと削除します。

### 3. 消えないエラーログ（`Logger`）

`window.onerror` と `unhandledrejection` を拾い、`Store` の失敗も拾い、**画面パネル＋localStorage** の両方に残します。Logger は `Store` に依存させず（循環回避）、自前で `localStorage` を直接触る → ストレージが死んでも最低限ログ機能は動きます。

```js
window.addEventListener("error", function(ev){
  Logger.error("window.onerror", (ev.message||"") + (ev.filename ? (" @"+ev.filename+":"+ev.lineno+":"+ev.colno) : ""));
});
window.addEventListener("unhandledrejection", function(ev){
  var r = ev.reason;
  Logger.error("unhandledrejection", (r && r.stack) ? (r.message+"\n"+r.stack) : (r && r.message ? r.message : r));
});
```

エントリが1件でも入るとパネルを自動表示。次回起動時に過去のエラーがあれば開いた状態で見せます。

### 4. 「閉じた状態」を表す週次の状態フラグ（`weekBare`）

桜リセットは、つぼみ🪷に戻すのではなく**全部消して閉じる**仕様。`weekDone:boolean[7]` に加えて `weekBare:boolean` を一つ足し、`bare && !done` のマスだけ「closed（点線の空きマス）」として描画します。新しい週が始まると `weekBare=false` に戻り、通常のつぼみ表示へ。

### 5. 毎週日曜23:59:59の自動リセット ── 単一の真実

「次回リセットまでのms」と「画面ラベルの日付」を別々に計算していると将来ズレます。**純粋関数を1個**にして、ms・ラベル・タイマー標的のすべてがそこを参照する形にします。

```js
var WEEK_RESET_HOUR=23, WEEK_RESET_MIN=59, WEEK_RESET_SEC=59;

// now から見た「次の日曜 23:59:59」。今日が日曜で時刻前なら当日、それ以外は翌週。常に日曜を返す。
function nextSundayReset(now){
  now = now || new Date();
  var target = new Date(now.getFullYear(), now.getMonth(), now.getDate(),
                        WEEK_RESET_HOUR, WEEK_RESET_MIN, WEEK_RESET_SEC, 0);
  var add = (7 - now.getDay()) % 7;            // 日曜なら0
  target.setDate(target.getDate() + add);
  if(target.getTime() <= now.getTime()){ target.setDate(target.getDate() + 7); }
  return target;
}
function msUntilSundayEnd(){ return nextSundayReset(new Date()).getTime() - Date.now(); }
```

さらに**取りこぼし救済**。PCのスリープやタイマー間引きで予定時刻を過ぎても、タブ復帰時に検知して実行します。

```js
function checkMissedWeekReset(){
  if(_weekResetTarget && Date.now() >= _weekResetTarget){ fireWeekAutoReset(); scheduleWeekAutoReset(); }
  else { updateResetInfo(); }
}
document.addEventListener("visibilitychange", function(){ if(document.visibilityState==="visible") checkMissedWeekReset(); });
window.addEventListener("focus", checkMissedWeekReset);
```

> 補足：1週間は約6.05億ms。`setTimeout` の上限（約24.8日 = 2^31-1 ms）に収まるので、週次なら1発のタイマーでオーバーフローしません。日本（JST・DSTなし）前提なので時刻の足し算もシンプルにできます。

---

## テスト手法 ── 単一HTMLを「実際に読み込んで」検証する

UIロジックを純粋関数に切り出すのは良い習慣ですが、このツールの肝（書きかけ復元・エラーログ表示・タイマー標的）は**DOMとlocalStorageに強く結びついて**います。なので関数の単体テストだけでは足りません。**実ファイルを jsdom に読み込み、ユーザー操作を模擬**して検証します。

```js
const { JSDOM, VirtualConsole } = require("jsdom");
const HTML = require("fs").readFileSync("usausa_dokusho_techo_v8.html","utf8");

function makeDom(opts){
  opts = opts || {};
  return new JSDOM(HTML, {
    runScripts: "dangerously",      // インラインscriptを実行
    pretendToBeVisual: true,
    url: "https://localhost/",      // これでlocalStorageが有効になる
    beforeParse(window){            // ★スクリプト実行前に介入できる
      Object.keys(opts.seed||{}).forEach(k => window.localStorage.setItem(k, opts.seed[k]));
      window.alert   = function(){ window.__alert = true; };  // alert検出
      window.confirm = function(){ return !!opts.confirmReturn; };
      window.prompt  = function(){ return null; };
    }
  });
}
```

トップレベルの `var`/`function` は `runScripts:"dangerously"` だと `window` プロパティになるので、`w.Store` `w.InputDraft` `w.Logger` `w.state` `w.nextSundayReset` をテストから直接叩けます。

### 手法1：`beforeParse` で「タブを閉じて開き直す」を再現

jsdom はインスタンスをまたいで `localStorage` を共有しません。そこで**セッション1で書いた下書きJSONを取り出し、セッション2の `beforeParse` で seed** すれば、「閉じる→開く」を正確に模擬できます。

```js
const w1 = makeDom().window;
type(w1, "nDef", "べき等性とは…");
const raw = w1.localStorage.getItem("usausa_techo_input_v1");   // 退避

const w2 = makeDom({ seed: { "usausa_techo_input_v1": raw } }).window;
assert(w2.document.getElementById("nDef").value === "べき等性とは…");  // 復元された
```

### 手法2：`Storage.prototype` を差し替えて「保存失敗」を起こす

容量超過は普通には再現しづらいので、ロード後に `setItem` を例外化して、`Store.set` が `false` を返し・メモリから読み戻せ・ログに残ることを確認します。

```js
const orig = w.Storage.prototype.setItem;
w.Storage.prototype.setItem = function(){ throw new Error("QuotaExceededError(test)"); };
assert(w.Store.set("k", {a:1}) === false);                       // 失敗を返す
assert(JSON.stringify(w.Store.get("k")) === JSON.stringify({a:1})); // メモリ退避で消えない
assert(w.Logger.entries().some(e => /Store\.set/.test(e.c)));     // ログに残る
w.Storage.prototype.setItem = orig;
```

### 手法3：スケジューラを「独立参照実装」と総当たり比較

タイマーの実発火はテストしづらいので、**純粋関数 `nextSundayReset(input)` を多数の入力で検証**します。期待値はアプリとは別ロジック（入力より後の最初の日曜23:59:59を線形探索）で作り、3週間×代表7時刻＝147サンプルを総当たり。

```js
function expectedReset(input){               // appとは別実装
  const t = new D(input.getFullYear(), input.getMonth(), input.getDate(), 23,59,59,0);
  while(!(t.getDay()===0 && t.getTime() > input.getTime())) t.setDate(t.getDate()+1);
  return t;
}
for(let dd=0; dd<21; dd++) for(const [h,m,s] of times){
  const input = new D(2026,5,15+dd,h,m,s,0);
  const got = w.nextSundayReset(input);
  assert(got.getDay()===0 && got.getHours()===23 && got.getMinutes()===59 && got.getSeconds()===59);
  assert(got.getTime() === expectedReset(input).getTime());
}
```

境界（日曜の朝＝当日／23:59:59ちょうど＝翌週／月曜＝直近日曜）も個別に確認。**TZ=Asia/Tokyo で実行**して本番のJSTと揃えます。取りこぼし救済は「標的を過去にして `checkMissedWeekReset()` を叩く→`weekBare===true`」で検証します。

```bash
TZ=Asia/Tokyo node test_commercial.js
# => 結果:  PASS 52  /  FAIL 0   (計 52)
```

### テストで見ているもの（抜粋）

- 書きかけ自動保存／別セッション復元／綴じ・読了・クリアで下書きが消える
- エラーログの表示・件数・永続化、`window.onerror` 捕捉、保存失敗時のメモリ退避
- 桜リセット回帰（つぼみ全消し＋DEBUG alertが出ない）
- 自動リセットの曜日・時刻・未来性・参照一致・取りこぼし救済
- 既存機能（和菓子+1・継続日数）の非破壊

---

## まとめ

- **保存層は「失敗してもメモリで継続＋ログ」**にするだけで体感の堅牢性が上がる。
- **書きかけは専用キーに自動保存**。状態（確定データ）と下書き（編集中）は分ける。
- **時刻ロジックは純粋関数1個に集約**し、ms・表示・タイマーを同じ真実から導く。スリープ対策に復帰時の取りこぼし救済を足す。
- **単一HTMLでも jsdom で実ファイルを読み込めば商用テストできる**。`beforeParse` seed で「タブ閉じ」を、`Storage.prototype` 差し替えで「保存失敗」を、独立参照実装との総当たりで「週次タイマー」を、それぞれ再現する。

フレームワークが無くても、設計とテストの型さえ持っていれば1ファイルで十分実用に耐えます。

> 🐰 うさうさ研修工房 ｜ ver 8.0
