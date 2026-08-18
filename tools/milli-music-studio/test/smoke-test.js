/* MMS UIスモークテスト（jsdomで初期化・MIDI読込・変換・ZIP生成までを実行） */
"use strict";
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const MMS_DIR = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(MMS_DIR, "index.html"), "utf8");
const core = fs.readFileSync(path.join(MMS_DIR, "mms-core.js"), "utf8");
const inline = fs.readFileSync(path.join(MMS_DIR, "index.html"), "utf8").match(/<script>([\s\S]*?)<\/script>/)[1];
const { createTestMidi } = require(path.join(MMS_DIR, "test", "midi-writer.js"));

const dom = new JSDOM(html, { url: "https://mms.local/index.html", runScripts: "outside-only", pretendToBeVisual: true });
const { window } = dom;
const { document } = window;

function makeCtx() {
  return new Proxy({}, {
    get(t, k) {
      if (k === "canvas") return { width: 900, height: 520 };
      return (...args) => undefined;
    },
    set() { return true; },
  });
}

const elements = {};
function makeElement(id) {
  if (elements[id]) return elements[id];
  const el = {
    id,
    value: "",
    textContent: "",
    innerHTML: "",
    className: "",
    style: {},
    onclick: null,
    onchange: null,
    onmousedown: null,
    ondblclick: null,
    children: [],
    appendChild(c) { this.children.push(c); return c; },
    querySelector() { return makeElement("query-" + Math.random()); },
    querySelectorAll() { return []; },
    classList: { add() {}, remove() {}, contains() { return false; } },
    dataset: {},
    addEventListener() {},
    setAttribute() {},
    getContext() { return makeCtx(); },
    append(...nodes) { this.children.push(...nodes); },
  };
  elements[id] = el;
  return el;
}

document.getElementById = (id) => makeElement(id);
document.querySelectorAll = () => [];
document.querySelector = () => null;
document.createElement = (tag) => makeElement("created-" + tag);
document.addEventListener = () => {};

window.AudioContext = class { constructor() { this.state = "running"; this.currentTime = 0; this.destination = {}; } resume() {} createOscillator() { return { type: "", frequency: { value: 0 }, connect() { return { connect() {} }; }, start() {}, stop() {} }; } createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() { return { connect() {} }; } }; } };
window.URL.createObjectURL = () => "blob:fake";
window.URL.revokeObjectURL = () => {};

const midiBytes = Array.from(createTestMidi()).join(",");

// インラインスクリプト＋テストコードを同一evalで実行（strictモードのスコープ問題を回避）
const testCode = `
(function(){
  const results = [];
  function check(name, cond) { results.push({name, cond}); console.log((cond ? "  ✓ " : "  ✗ ") + name); }
  try {
    check("初期化が例外なく完了", true);

    applyMidiParse(MMS.parseMidi(new Uint8Array([${midiBytes}])), "test.mid");
    check("MIDI読込後にパートが2つ", project.parts.length === 2);
    check("プロジェクト名が反映", project.name === "test");

    project.parts[0].notes.push({pitch:62,startTick:100,durationTick:240,velocity:80});
    markDirty();
    check("手動ノート追加でtotalTicks更新", project.totalTicks >= 340);
    refreshNotePanel();
    check("ノートテーブル描画（例外なし）", true);

    cfgTranspose.value = "0"; cfgMinLen.value = "0"; cfgMinPitch.value = "0"; cfgMaxPitch.value = "127"; cfgLoop.value = "0";
    $("btnBuild").onclick();
    check("出力サマリーが生成", typeof $("exportSummary").textContent === "string" && $("exportSummary").textContent.length > 0);
    check("警告表示", typeof $("warnings").textContent === "string");

    let zipBytes = null;
    $("btnZip").onclick = function(){ zipBytes = MMS.buildZip(lastBuild.files); };
    $("btnZip").onclick();
    check("ZIPが生成された", zipBytes && zipBytes.length > 100);

    $("btnPlay").onclick(); $("btnStop").onclick();
    check("再生/停止が例外なく動作", true);

    refreshPartList();
    check("パートリスト描画（例外なし）", true);

    const saved = JSON.stringify(project);
    check("JSON保存可能", typeof saved === "string" && saved.includes("parts"));
  } catch (e) {
    check("テスト実行中に例外なし: " + e.message, false);
    results[results.length-1] = { name: results[results.length-1].name + " → " + e.stack, cond: false };
  }
  window.__smokeResults = results;
})();
`;

window.eval(core + "\n" + inline + "\n" + testCode);

const results = window.__smokeResults || [];
let ok = results.length > 0 && results.every((r) => r.cond);
results.forEach((r) => {
  if (!r.cond) console.error("FAILED:", r.name);
});
console.log("\n" + (ok ? "SMOKE TEST: ALL PASS (" + results.length + " checks)" : "SMOKE TEST: FAILED (" + results.filter(r=>r.cond).length + "/" + results.length + ")"));
process.exit(ok ? 0 : 1);
