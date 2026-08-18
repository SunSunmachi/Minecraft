/* Milli Music Studio テストランナー
 * 実行: node test/run-tests.js */
"use strict";
const MMS = require("../mms-core.js");
const { createTestMidi } = require("./midi-writer.js");

let passed = 0;
let failed = 0;

function assert(name, cond, detail) {
  if (cond) {
    passed++;
    console.log("  ✓ " + name);
  } else {
    failed++;
    console.log("  ✗ " + name + (detail !== undefined ? "  [got: " + detail + "]" : ""));
  }
}

function approx(a, b, eps) {
  return Math.abs(a - b) < (eps || 1e-6);
}

/* =========================================================
 * 1. MIDIパーサー
 * ========================================================= */
console.log("== MIDIパーサー ==");
const midi = createTestMidi();
let parsed;
try {
  parsed = MMS.parseMidi(midi);
  assert("パース成功（例外なし）", true);
} catch (e) {
  assert("パース成功（例外なし）", false, e.message);
  process.exit(1);
}

assert("division = 480", parsed.division === 480, parsed.division);
assert("トラック数 = 2", parsed.tracks.length === 2, parsed.tracks.length);
assert("テンポマップ = 2件", parsed.tempoMap.length === 2, parsed.tempoMap.length);
assert("テンポ120@0", parsed.tempoMap[0].bpm === 120, parsed.tempoMap[0].bpm);
assert("テンポ60@1920", parsed.tempoMap[1].bpm === 60 && parsed.tempoMap[1].tick === 1920, JSON.stringify(parsed.tempoMap[1]));
assert("タイムシグネチャ 4/4", parsed.timeSig.num === 4 && parsed.timeSig.den === 4, JSON.stringify(parsed.timeSig));

const t1 = parsed.tracks[0];
const t2 = parsed.tracks[1];
assert("トラック1: 音符5つ（テンポ変更前3 + 後2）", t1.notes.length === 5, t1.notes.length);
assert("トラック1: 最初の音符 C4@0 長さ480", t1.notes[0].pitch === 60 && t1.notes[0].startTick === 0 && t1.notes[0].durationTick === 480, JSON.stringify(t1.notes[0]));
assert("トラック1: E4はnote_on vel0で終了", t1.notes[1].pitch === 64 && t1.notes[1].durationTick === 480, JSON.stringify(t1.notes[1]));
assert("トラック1: 4音目は60BPM区間 C5@1920", t1.notes[3].pitch === 72 && t1.notes[3].startTick === 1920, JSON.stringify(t1.notes[3]));
assert("トラック1: 5音目 D5@2400", t1.notes[4].pitch === 74 && t1.notes[4].startTick === 2400, JSON.stringify(t1.notes[4]));
assert("トラック1: channel = 0", t1.notes.every((n) => n.channel === 0), "channel混在");

assert("トラック2: 音符4つ（最後は強制クローズ）", t2.notes.length === 4, t2.notes.length);
assert("トラック2: 名前 = Melody2", t2.name === "Melody2", t2.name);
assert("トラック2: channel = 2", t2.notes.every((n) => n.channel === 2), "channel混在");
assert(
  "トラック2: 8分音符（ランニングステータス/vel0/他ch off/再トリガーを正しく処理）",
  t2.notes[0].durationTick === 240 && t2.notes[1].durationTick === 240 && t2.notes[2].durationTick === 240,
  JSON.stringify(t2.notes.map((n) => n.durationTick))
);
assert("トラック2: 未終了ノートが末尾でクローズ", t2.notes[3].startTick === 720 && t2.notes[3].durationTick === 1, JSON.stringify(t2.notes[3]));

assert("noteName(60) = C4", MMS.noteName(60) === "C4", MMS.noteName(60));
assert("noteName(61) = C#4", MMS.noteName(61) === "C#4", MMS.noteName(61));
assert("noteName(69) = A4", MMS.noteName(69) === "A4", MMS.noteName(69));

/* =========================================================
 * 2. 時間計算
 * ========================================================= */
console.log("== 時間計算 ==");
const div = parsed.division;
const tempoMap = parsed.tempoMap;
assert("tick0 → 0秒", MMS.ticksToSeconds(0, tempoMap, div) === 0, MMS.ticksToSeconds(0, tempoMap, div));
assert("tick1920（120BPM）→ 2秒", approx(MMS.ticksToSeconds(1920, tempoMap, div), 2.0), MMS.ticksToSeconds(1920, tempoMap, div));
assert("tick2400（60BPM区間）→ 3秒", approx(MMS.ticksToSeconds(2400, tempoMap, div), 3.0), MMS.ticksToSeconds(2400, tempoMap, div));
assert("tick480（120BPM）→ 0.5秒", approx(MMS.ticksToSeconds(480, tempoMap, div), 0.5), MMS.ticksToSeconds(480, tempoMap, div));
assert("secondsToTicks(2.0) → 1920", MMS.secondsToTicks(2.0, tempoMap, div) === 1920, MMS.secondsToTicks(2.0, tempoMap, div));
assert("secondsToTicks(3.0) → 2400", MMS.secondsToTicks(3.0, tempoMap, div) === 2400, MMS.secondsToTicks(3.0, tempoMap, div));
assert("空テンポマップでクラッシュしない", typeof MMS.ticksToSeconds(100, [], 480) === "number");

/* =========================================================
 * 3. 変換（applySettings / pitchForNote）
 * ========================================================= */
console.log("== 変換 ==");
const project = {
  name: "Test",
  division: 480,
  tempoMap: parsed.tempoMap,
  timeSig: { num: 4, den: 4 },
  totalTicks: parsed.totalTicks,
  parts: [
    { id: "p1", name: "Melody2", channel: 2, sound: "ms.sound.melody", rootNote: 60, notes: t2.notes },
    { id: "p2", name: "Track 1", channel: 0, sound: "ms.sound.bass", rootNote: 48, notes: t1.notes },
  ],
};

assert("pitchForNote(72, 60) = 2.0", approx(MMS.pitchForNote(72, 60), 2.0), MMS.pitchForNote(72, 60));
assert("pitchForNote(48, 60) = 0.5", approx(MMS.pitchForNote(48, 60), 0.5), MMS.pitchForNote(48, 60));
assert("pitchForNote(60, 60) = 1.0", approx(MMS.pitchForNote(60, 60), 1.0), MMS.pitchForNote(60, 60));

const r1 = MMS.applySettings(project, {
  transpose: 0, minLengthMs: 0, minPitch: 0, maxPitch: 127, loop: false,
});
assert("イベント数 = 音符数(9)", r1.events.length === 9, r1.events.length);
assert("イベントはtick順", r1.events.every((e, i) => i === 0 || r1.events[i - 1].tick <= e.tick));
assert(
  "tick = floor(秒×20)（C5@2.0秒→40, D5@3.0秒→60）",
  r1.events.some((e) => e.tick === 40) && r1.events.some((e) => e.tick === 60),
  r1.events.map((e) => e.tick).join(",")
);
assert("lastTick = 最後のイベントtick", r1.lastTick === 60, r1.lastTick);
const ev60 = r1.events.find((e) => e.tick === 60);
assert("60BPM区間の音は t=3.0秒 → tick60", ev60.tick === 60, ev60 && ev60.tick);

// 移調・除外・警告
const r2 = MMS.applySettings(project, {
  transpose: 12, minLengthMs: 5000, minPitch: 70, maxPitch: 80, loop: false,
});
assert("最小長5秒で全音符除外 → イベント0", r2.events.length === 0, r2.events.length);
assert("警告に最短音符長の記述", r2.warnings.some((w) => w.includes("最短音符長")), r2.warnings.join(" / "));

const r3 = MMS.applySettings(project, {
  transpose: 0, minLengthMs: 0, minPitch: 72, maxPitch: 72, loop: false,
});
assert("音域72限定: C5のみ残る", r3.events.length === 1 && r3.events[0].tick === 40, JSON.stringify(r3.events));
assert("音域外除外の警告", r3.warnings.some((w) => w.includes("音域外")), r3.warnings.join(" / "));

/* =========================================================
 * 4. mcfunction生成
 * ========================================================= */
console.log("== mcfunction生成 ==");
const f1 = MMS.buildMcfunctions(project, { transpose: 0, minLengthMs: 0, minPitch: 0, maxPitch: 127, loop: false });
assert("tick関数にplaysound行が9行", (f1.tick.match(/run playsound/g) || []).length === 9, (f1.tick.match(/run playsound/g) || []).length);
assert("start関数が ms_play を1に設定", f1.start.includes("scoreboard players set ms_play ms.time 1"), f1.start);
assert("start関数が ms_tick を -1 に設定", f1.start.includes("scoreboard players set ms_tick ms.time -1"), f1.start);
assert("setup関数にobjective定義", f1.setup.includes("scoreboard objectives add ms.time dummy"), f1.setup);
assert("stop関数が ms_play を0に", f1.stop.includes("scoreboard players set ms_play ms.time 0"), f1.stop);
assert("ループなし: 最終tick+1で停止", f1.tick.includes("matches 61 run scoreboard players set ms_play ms.time 0"), f1.tick);
assert("ピッチがコマンドに反映（A3@root60 → 0.841）", f1.tick.includes("ms.sound.melody @a ~ ~ ~ 1 0.841"), f1.tick);
assert("tick関数の全行にexecute条件がある", f1.tick.split("\n").filter((l) => l && !l.startsWith("#") && !l.startsWith("execute")).length === 0, f1.tick);

const f2 = MMS.buildMcfunctions(project, { transpose: 0, minLengthMs: 0, minPitch: 0, maxPitch: 127, loop: true });
assert("ループあり: 最終tickでカウンタリセット", f2.tick.includes("matches 61 run scoreboard players set ms_tick ms.time -1"), f2.tick);

/* =========================================================
 * 5. リソースパック生成
 * ========================================================= */
console.log("== RP生成 ==");
const soundsJson = MMS.buildSoundsJson(project);
const sounds = JSON.parse(soundsJson);
assert("sounds.jsonがパース可能", true);
assert("sound_definitionsに2パート", Object.keys(sounds.sound_definitions).length === 2, Object.keys(sounds.sound_definitions).length);
assert("ms.sound.melody → sounds/melody", sounds.sound_definitions["ms.sound.melody"].sounds[0].name === "sounds/melody", sounds.sound_definitions["ms.sound.melody"].sounds[0].name);
assert("stream=true", sounds.sound_definitions["ms.sound.melody"].sounds[0].stream === true);

const rpManifest = JSON.parse(MMS.buildManifest("resources", "test"));
assert("RPマニフェスト: モジュールtype=resources", rpManifest.modules[0].type === "resources", rpManifest.modules[0].type);
assert("RPマニフェスト: UUIDがv4形式", /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(rpManifest.header.uuid));
assert("BPマニフェスト: モジュールtype=data", JSON.parse(MMS.buildManifest("data", "test")).modules[0].type === "data");
assert("UUIDが毎回違う", MMS.uuid() !== MMS.uuid());

/* =========================================================
 * 6. ZIP生成（STORE）検証：実際に解凍して中身を確認
 * ========================================================= */
console.log("== ZIP生成 ==");

function unzipStore(bytes) {
  // EOCD探索
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("EOCD not found");
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = [];
  for (let i = 0; i < count; i++) {
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOff = dv.getUint32(p + 42, true);
    const nameBytes = bytes.slice(p + 46, p + 46 + nameLen);
    const name = String.fromCharCode.apply(null, nameBytes);
    // ローカルヘッダー
    const lnameLen = dv.getUint16(localOff + 26, true);
    const lextraLen = dv.getUint16(localOff + 28, true);
    const dataStart = localOff + 30 + lnameLen + lextraLen;
    const size = dv.getUint32(localOff + 22, true);
    const crc = dv.getUint32(localOff + 14, true);
    out.push({ name: name, data: bytes.slice(dataStart, dataStart + size), crc: crc });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function crc32FromZip(bytes) {
  let c = 0xffffffff;
  const table = (function () {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let x = n;
      for (let k = 0; k < 8; k++) x = x & 1 ? 0xedb88320 ^ (x >>> 1) : x >>> 1;
      t[n] = x >>> 0;
    }
    return t;
  })();
  for (let i = 0; i < bytes.length; i++) c = table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const zipBytes = MMS.buildZip([
  { name: "test/hello.txt", data: "こんにちは、ミリプロ！" },
  { name: "test/sub/empty.md", data: "" },
  { name: "test/notes.mcfunction", data: "execute if score a b matches 1 run playsound x @a" },
]);
assert("ZIP先頭 = PK", zipBytes[0] === 0x50 && zipBytes[1] === 0x4b);
let entries;
try {
  entries = unzipStore(zipBytes);
  assert("ZIP解凍成功", true);
} catch (e) {
  assert("ZIP解凍成功", false, e.message);
  entries = [];
}
assert("エントリ数 = 3", entries.length === 3, entries.length);
assert("エントリ名が正しい", entries.map((e) => e.name).join(",") === "test/hello.txt,test/sub/empty.md,test/notes.mcfunction", entries.map((e) => e.name).join(","));
const hello = entries.find((e) => e.name === "test/hello.txt");
assert("日本語データが正しく復元", hello && new TextDecoder().decode(hello.data) === "こんにちは、ミリプロ！", hello && new TextDecoder().decode(hello.data));
assert("CRCが一致", hello && hello.crc === crc32FromZip(hello.data), hello && hello.crc.toString(16));
const empty = entries.find((e) => e.name === "test/sub/empty.md");
assert("空ファイルのCRC = 0", empty && empty.crc === 0, empty && empty.crc);

/* =========================================================
 * まとめ
 * ========================================================= */
console.log("\n==============================");
console.log("合格: " + passed + " / " + (passed + failed));
console.log("不合格: " + failed);
process.exit(failed > 0 ? 1 : 0);