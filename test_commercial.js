/* うさうさ読書手帖 v7 商用テスト
   実際のHTMLをjsdomで読み込み、ユーザー操作を模擬して検証する。 */
const fs = require("fs");
const { JSDOM, VirtualConsole } = require("jsdom");

const FILE = "usausa_dokusho_techo_v7.html";
const HTML = fs.readFileSync(FILE, "utf8");
const INPUT_KEY = "usausa_techo_input_v1";
const ERRLOG_KEY = "usausa_techo_errlog_v1";

let pass = 0, fail = 0; const failed = [];
function ok(name, cond){
  if(cond){ pass++; console.log("  \u2705 " + name); }
  else { fail++; failed.push(name); console.log("  \u274C " + name); }
}
function section(t){ console.log("\n\u25A0 " + t); }

function makeDom(opts){
  opts = opts || {};
  const seed = opts.seed || {};
  const confirmReturn = !!opts.confirmReturn;
  const vc = new VirtualConsole();
  vc.on("jsdomError", function(e){
    if(!/Not implemented/.test(e.message)) console.log("   [jsdomError] " + e.message);
  });
  return new JSDOM(HTML, {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    url: "https://localhost/",
    virtualConsole: vc,
    beforeParse: function(window){
      try{ Object.keys(seed).forEach(function(k){ window.localStorage.setItem(k, seed[k]); }); }
      catch(e){ console.log("   [seed error] " + e.message); }
      window.__alert = false;
      window.alert   = function(){ window.__alert = true; };
      window.confirm = function(){ return confirmReturn; };
      window.prompt  = function(){ return null; };
    }
  });
}
function type(win, id, val){
  const el = win.document.getElementById(id);
  el.value = val;
  el.dispatchEvent(new win.Event("input",  { bubbles:true }));
  el.dispatchEvent(new win.Event("change", { bubbles:true }));
}
function click(win, id){ win.document.getElementById(id).click(); }

const doms = [];
function track(d){ doms.push(d); return d; }

try{
  /* ---------------------------------------------------------------- */
  section("1. 書きかけ入力の自動保存（localStorageへ即時保存）");
  const d1 = track(makeDom());
  const w1 = d1.window;
  const DEF_TEXT  = "べき等性とは、何回実行しても結果が同じになる性質のこと。";
  const META_TEXT = "自動販売機のボタン連打みたいなもの。";
  type(w1, "nTitle", "べき等性");
  type(w1, "nDef",  DEF_TEXT);
  type(w1, "nMeta", META_TEXT);
  const rawDraft = w1.localStorage.getItem(INPUT_KEY);
  ok("localStorageに下書きキーが保存される", !!rawDraft);
  let parsed = rawDraft ? JSON.parse(rawDraft) : {};
  ok("入力した定義テキストが保存されている", parsed.nDef === DEF_TEXT);
  ok("入力したたとえテキストが保存されている", parsed.nMeta === META_TEXT);
  ok("保存時刻(_savedAt)が記録される", typeof parsed._savedAt === "number");
  ok("『書きかけ自動保存中』のステータスが表示される",
     w1.document.getElementById("inputDraftStatus").style.display === "block");

  /* ---------------------------------------------------------------- */
  section("2. タブを閉じても残る（別セッションで復元）");
  const d2 = track(makeDom({ seed: { [INPUT_KEY]: rawDraft } }));
  const w2 = d2.window;
  ok("再起動後、定義テキストが復元される",
     w2.document.getElementById("nDef").value === DEF_TEXT);
  ok("再起動後、たとえテキストが復元される",
     w2.document.getElementById("nMeta").value === META_TEXT);
  ok("再起動後、テーマも復元される",
     w2.document.getElementById("nTitle").value === "べき等性");

  /* ---------------------------------------------------------------- */
  section("3. 手帖に綴じると下書きが消える");
  click(w2, "noteSaveBtn");
  ok("手帖が1枚追加される", Array.isArray(w2.state.notes) && w2.state.notes.length === 1);
  ok("綴じた手帖に定義が入っている", w2.state.notes[0].def === DEF_TEXT);
  ok("綴じた後フォームが空になる", w2.document.getElementById("nDef").value === "");
  const after = w2.localStorage.getItem(INPUT_KEY);
  const afterParsed = after ? JSON.parse(after) : null;
  const afterHasNote = afterParsed && (afterParsed.nDef || afterParsed.nMeta || afterParsed.nTitle);
  ok("綴じた後は下書き(手帖項目)が残らない", !afterHasNote);

  /* ---------------------------------------------------------------- */
  section("4. 「入力を消す」で下書きクリア");
  const d4 = track(makeDom());
  const w4 = d4.window;
  type(w4, "nTitle", "テスト");
  ok("クリア前は下書きあり", !!w4.localStorage.getItem(INPUT_KEY));
  click(w4, "noteClearBtn");
  ok("クリア後はフォームが空", w4.document.getElementById("nTitle").value === "");
  ok("クリア後は下書きが消える", !w4.localStorage.getItem(INPUT_KEY));

  /* ---------------------------------------------------------------- */
  section("5. 「読み終えた」で読書欄の下書きクリア");
  const d5 = track(makeDom());
  const w5 = d5.window;
  type(w5, "bookTitle", "リーダブルコード");
  type(w5, "goalNum", "30");
  ok("読書欄の下書きが保存される",
     JSON.parse(w5.localStorage.getItem(INPUT_KEY)).bookTitle === "リーダブルコード");
  click(w5, "finishBtn");
  ok("読了が記録される(readDate)", !!w5.state.readDate);
  const d5draft = w5.localStorage.getItem(INPUT_KEY);
  const d5parsed = d5draft ? JSON.parse(d5draft) : null;
  const d5has = d5parsed && d5parsed.bookTitle;
  ok("読了後は本タイトルの下書きが残らない", !d5has);

  /* ---------------------------------------------------------------- */
  section("6. エラーログ：表示・件数・永続化");
  const d6 = track(makeDom());
  const w6 = d6.window;
  ok("初期状態はログ非表示", !w6.document.getElementById("errlog").classList.contains("show"));
  click(w6, "errlogTestBtn");
  ok("疑似エラーでログ件数が増える", w6.Logger.entries().length >= 1);
  ok("エラー発生でログパネルが自動表示", w6.document.getElementById("errlog").classList.contains("show"));
  ok("ログ行がDOMに描画される",
     w6.document.querySelectorAll("#errlogBody .errlog-row").length >= 1);
  ok("ログがlocalStorageに永続化される(タブを閉じても残る)", !!w6.localStorage.getItem(ERRLOG_KEY));
  click(w6, "errlogClearBtn");
  ok("ログ消去でエントリが0になる", w6.Logger.entries().length === 0);

  /* ---------------------------------------------------------------- */
  section("7. グローバル例外を捕捉してログに残す");
  const d7 = track(makeDom());
  const w7 = d7.window;
  const before7 = w7.Logger.entries().length;
  const ev = new w7.Event("error");
  ev.message = "boom-test-uncaught";
  w7.dispatchEvent(ev);
  const got7 = w7.Logger.entries().some(function(e){ return /boom-test-uncaught/.test(e.m); });
  ok("window.onerror がログに記録される", w7.Logger.entries().length > before7 && got7);

  /* ---------------------------------------------------------------- */
  section("8. 保存失敗時：ログ記録＋メモリ退避（容量超過の模擬）");
  const d8 = track(makeDom());
  const w8 = d8.window;
  const origSet = w8.Storage.prototype.setItem;
  w8.Storage.prototype.setItem = function(){ throw new Error("QuotaExceededError(test)"); };
  const ret = w8.Store.set("usa_probe_key", { hello: "world" });
  ok("保存失敗時 Store.set が false を返す", ret === false);
  ok("保存失敗時もメモリから読み戻せる(データ消失なし)",
     JSON.stringify(w8.Store.get("usa_probe_key", null)) === JSON.stringify({ hello: "world" }));
  const loggedStoreErr = w8.Logger.entries().some(function(e){ return /Store\.set/.test(e.c); });
  ok("保存失敗がエラーログに残る", loggedStoreErr);
  w8.Storage.prototype.setItem = origSet;

  /* ---------------------------------------------------------------- */
  section("9. 桜リセット回帰：つぼみ全消し＝閉じた状態（前回変更の再確認）");
  const d9 = track(makeDom({ confirmReturn: true }));
  const w9 = d9.window;
  // 通常時はつぼみ🪷が表示されている
  ok("通常時は週につぼみ🪷が出ている", /🪷/.test(w9.document.getElementById("week").innerHTML));
  click(w9, "weekResetBtn");
  ok("リセット後 weekBare=true になる", w9.state.weekBare === true);
  ok("リセット後つぼみ🪷が消える", !/🪷/.test(w9.document.getElementById("week").innerHTML));
  ok("リセット後7マスすべて closed（閉じた状態）",
     w9.document.querySelectorAll("#week .day.closed").length === 7);
  ok("リセット時にDEBUG alertが出ない", w9.__alert === false);

  /* ---------------------------------------------------------------- */
  section("10. 既存機能の非破壊（和菓子・継続）");
  const d10 = track(makeDom());
  const w10 = d10.window;
  const w0 = w10.state.wagashi;
  type(w10, "nTitle", "観測"); type(w10, "nDef", "確認");
  click(w10, "noteSaveBtn");
  ok("手帖を綴じると和菓子が増える", w10.state.wagashi === w0 + 1);
  ok("継続日数が記録される(streak>=1)", w10.state.streak >= 1);

} catch(err){
  console.log("\n\u274C テスト実行中に例外: " + (err && err.stack ? err.stack : err));
  fail++; failed.push("harness-exception");
} finally {
  doms.forEach(function(d){ try{ d.window.close(); }catch(e){} });
}

console.log("\n" + "=".repeat(48));
console.log("  結果:  PASS " + pass + "  /  FAIL " + fail + "   (計 " + (pass+fail) + ")");
if(fail){ console.log("  失敗項目: " + failed.join(", ")); }
console.log("=".repeat(48));
process.exit(fail ? 1 : 0);
