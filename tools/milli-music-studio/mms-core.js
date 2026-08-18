/* Milli Music Studio - core logic
 * ブラウザ（index.html）とNode（テスト）の両方から使えるUMDモジュール。
 * 依存ゼロ。 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.MMS = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const MMS = {};

  /* =========================================================
   * MIDI (SMF) パーサー
   * ========================================================= */

  function readVLQ(data, pos) {
    let value = 0;
    let b;
    let count = 0;
    do {
      if (pos >= data.length) throw new Error("VLQがデータ末尾を超えました");
      b = data[pos++];
      value = (value << 7) | (b & 0x7f);
      count++;
      if (count > 4) throw new Error("VLQが4バイトを超えました");
    } while (b & 0x80);
    return { value: value, pos: pos };
  }

  const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

  MMS.noteName = function (midiNote) {
    const o = Math.floor(midiNote / 12) - 1;
    return NOTE_NAMES[midiNote % 12] + o;
  };

  MMS.noteToHz = function (midiNote) {
    return 440 * Math.pow(2, (midiNote - 69) / 12);
  };

  /**
   * MIDIファイルを解析する。
   * @param {Uint8Array} data
   * @returns {{format, division, tempoMap, timeSig, totalTicks, tracks, errors}}
   *   tracks: [{name, channel, notes: [{pitch, startTick, durationTick, velocity}]}]
   *   tempoMap: [{tick, bpm}] （昇順・tick 0 から）
   *   timeSig: {tick, num, den}
   */
  MMS.parseMidi = function (data) {
    const errors = [];
    let pos = 0;

    function readChunkHeader() {
      if (pos + 8 > data.length) throw new Error("チャンクヘッダーが読めません");
      const id = String.fromCharCode(data[pos], data[pos + 1], data[pos + 2], data[pos + 3]);
      const len =
        (data[pos + 4] << 24) | (data[pos + 5] << 16) | (data[pos + 6] << 8) | data[pos + 7];
      pos += 8;
      return { id: id, len: len };
    }

    const header = readChunkHeader();
    if (header.id !== "MThd") throw new Error("MThdヘッダーが見つかりません（MIDIファイルではありません）");
    const format = (data[pos] << 8) | data[pos + 1];
    const ntrks = (data[pos + 2] << 8) | data[pos + 3];
    const divisionRaw = (data[pos + 4] << 8) | data[pos + 5];
    pos += header.len;
    if (divisionRaw & 0x8000) {
      throw new Error("SMPTE分割方式のMIDIは非対応です（PPQ方式のみ）");
    }
    const division = divisionRaw;

    const rawTracks = [];
    for (let t = 0; t < ntrks; t++) {
      const ch = readChunkHeader();
      if (ch.id !== "MTrk") {
        pos += ch.len;
        continue;
      }
      const trackData = data.subarray(pos, pos + ch.len);
      pos += ch.len;
      rawTracks.push(trackData);
    }

    // トラックごとにイベントを展開
    const tempoMap = [];
    let timeSig = { tick: 0, num: 4, den: 4 };
    const parts = [];
    let maxTick = 0;

    rawTracks.forEach(function (trackData, ti) {
      let p = 0;
      let runningStatus = 0;
      let absolute = 0;
      let trackName = null;
      const pending = {}; // channel -> { pitch -> startTick }
      const notes = [];

      try {
        while (p < trackData.length) {
          const v = readVLQ(trackData, p);
          absolute += v.value;
          p = v.pos;

          let status = trackData[p++];
          if (!(status & 0x80)) {
            if (!runningStatus) throw new Error("ランニングステータスが不正です");
            p--; // データバイトを巻き戻す
            status = runningStatus;
          } else {
            runningStatus = status;
          }

const kind = status & 0xf0;
      const channel = status & 0x0f;

      if (kind === 0x80 || kind === 0x90) {
        const pitch = trackData[p];
        const vel = trackData[p + 1];
        p += 2;
        const penMap = pending[channel] || (pending[channel] = {});
        if (kind === 0x90 && vel === 0) {
          // note-on velocity 0 = note-off
          const start = penMap[pitch];
          if (start !== undefined) {
            notes.push({ pitch: pitch, startTick: start, durationTick: Math.max(1, absolute - start), velocity: 0, channel: channel });
            delete penMap[pitch];
          }
        } else if (kind === 0x90) {
          if (penMap[pitch] !== undefined) {
            // 同一ピッチで重なって鳴っている場合は、前の音を閉じて再トリガー扱い
            notes.push({ pitch: pitch, startTick: penMap[pitch], durationTick: Math.max(1, absolute - penMap[pitch]), velocity: 0, channel: channel });
          }
          penMap[pitch] = absolute;
        } else {
          // note off
          const start = penMap[pitch];
          if (start !== undefined) {
            notes.push({ pitch: pitch, startTick: start, durationTick: Math.max(1, absolute - start), velocity: 0, channel: channel });
            delete penMap[pitch];
          }
        }
      } else if (kind === 0xa0 || kind === 0xb0 || kind === 0xe0) {
            p += 2;
          } else if (kind === 0xc0 || kind === 0xd0) {
            p += 1;
          } else if (status === 0xff) {
            const type = trackData[p++];
            const lv = readVLQ(trackData, p);
            p = lv.pos;
            const body = trackData.subarray(p, p + lv.value);
            p += lv.value;
            if (type === 0x51 && lv.value >= 3) {
              const us = (body[0] << 16) | (body[1] << 8) | body[2];
              tempoMap.push({ tick: absolute, bpm: 60000000 / us });
            } else if (type === 0x58 && lv.value >= 2) {
              const num = body[0];
              const den = Math.pow(2, body[1]);
              if (absolute === 0) timeSig = { tick: 0, num: num, den: den };
            } else if (type === 0x03) {
              trackName = String.fromCharCode.apply(null, body);
            } else if (type === 0x2f) {
              break;
            }
          } else if (status === 0xf0 || status === 0xf7) {
            const lv = readVLQ(trackData, p);
            p = lv.pos + lv.value;
          } else {
            // 未知のステータス：安全側にスキップ
            errors.push("トラック" + ti + ": 未知のステータス 0x" + status.toString(16) + "（スキップ）");
          }
        }
      } catch (e) {
        errors.push("トラック" + ti + ": " + e.message);
      }

      // トラック末尾で未終了のノートを閉じる
      for (const ch in pending) {
        for (const pitch in pending[ch]) {
          const start = pending[ch][pitch];
          notes.push({ pitch: +pitch, startTick: start, durationTick: Math.max(1, absolute - start), velocity: 0, channel: +ch });
        }
      }

      notes.sort(function (a, b) {
        return a.startTick - b.startTick || a.pitch - b.pitch;
      });
      notes.forEach(function (n) {
        if (n.startTick + n.durationTick > maxTick) maxTick = n.startTick + n.durationTick;
      });

      if (notes.length > 0) {
        // トラック内で使われているチャンネルのうち最小のものを採用
        let ch = 0;
        notes.forEach(function (n) {
          if (ch === 0 || n.channel < ch) ch = n.channel;
        });
        parts.push({
          name: trackName || "Track " + (ti + 1),
          channel: ch,
          notes: notes,
        });
      }
    });

    tempoMap.sort(function (a, b) {
      return a.tick - b.tick;
    });
    if (tempoMap.length === 0) {
      tempoMap.push({ tick: 0, bpm: 120 });
    }

    return {
      format: format,
      division: division,
      tempoMap: tempoMap,
      timeSig: timeSig,
      totalTicks: maxTick,
      tracks: parts,
      errors: errors,
    };
  };

  /* =========================================================
   * 時間計算（tick → 秒）
   * ========================================================= */

  MMS.ticksToSeconds = function (tick, tempoMap, division) {
    if (tempoMap.length === 0 || division <= 0) return tick / 480 / 2; // フォールバック
    // tempoMap は昇順
    let segStartTick = 0;
    let segStartSec = 0;
    let bpm = tempoMap[0].bpm;
    for (let i = 0; i < tempoMap.length; i++) {
      const seg = tempoMap[i];
      if (tick <= seg.tick) break;
      segStartSec += ((seg.tick - segStartTick) / division) * (60 / bpm);
      segStartTick = seg.tick;
      bpm = seg.bpm;
    }
    return segStartSec + ((tick - segStartTick) / division) * (60 / bpm);
  };

  MMS.secondsToTicks = function (sec, tempoMap, division) {
    if (tempoMap.length === 0 || division <= 0) return Math.round(sec * 960);
    let segStartTick = 0;
    let segStartSec = 0;
    let bpm = tempoMap[0].bpm;
    for (let i = 0; i < tempoMap.length; i++) {
      const seg = tempoMap[i];
      if (sec <= segStartSec + ((seg.tick - segStartTick) / division) * (60 / bpm)) break;
      segStartSec += ((seg.tick - segStartTick) / division) * (60 / bpm);
      segStartTick = seg.tick;
      bpm = seg.bpm;
    }
    return Math.round(segStartTick + (sec - segStartSec) * (bpm / 60) * division);
  };

  /* =========================================================
   * 変換（音符 → /playsound コマンド）
   * ========================================================= */

  MMS.pitchForNote = function (midiNote, rootNote) {
    return Math.pow(2, (midiNote - rootNote) / 12);
  };

  /**
   * 変換設定を適用し、警告を集める。
   * @param {object} project
   * @param {object} s {transpose, minLengthMs, minPitch, maxPitch, loop}
   * @returns {{events: [{tick, sound, pitch}], warnings: [], lastTick, durationSec}}
   */
  MMS.applySettings = function (project, s) {
    const warnings = [];
    const division = project.division || 480;
    const events = [];
    let droppedMinLen = 0;
    let droppedRange = 0;
    const droppedRangeSamples = [];
    const clampedPitch = [];

    project.parts.forEach(function (part) {
      part.notes.forEach(function (n) {
        const lenMs = MMS.ticksToSeconds(n.durationTick, project.tempoMap, division) * 1000;
        if (lenMs < s.minLengthMs) {
          droppedMinLen++;
          return;
        }
        let pitchN = n.pitch + s.transpose;
        if (pitchN < s.minPitch || pitchN > s.maxPitch) {
          droppedRange++;
          if (droppedRangeSamples.length < 5) {
            droppedRangeSamples.push(MMS.noteName(pitchN));
          }
          return;
        }
        const sec = MMS.ticksToSeconds(n.startTick, project.tempoMap, division);
        const tick = Math.max(0, Math.floor(sec * 20));
        const p = MMS.pitchForNote(pitchN, part.rootNote);
        if (p > 256 || p < 0.01) {
          clampedPitch.push({ note: MMS.noteName(pitchN), pitch: p });
        }
        const pitchClamped = Math.min(256, Math.max(0.01, p));
        events.push({ tick: tick, sound: part.sound, pitch: pitchClamped });
      });
    });

    events.sort(function (a, b) {
      return a.tick - b.tick || a.sound.localeCompare(b.sound);
    });

    if (droppedMinLen > 0) warnings.push("最短音符長未満で除外した音符: " + droppedMinLen + "個");
    if (droppedRange > 0) {
      warnings.push(
        "音域外で除外した音符: " + droppedRange + "個（例: " + droppedRangeSamples.join(", ") + "）"
      );
    }
    clampedPitch.forEach(function (c) {
      warnings.push(
        "音 " + c.note + " のピッチ " + c.pitch.toFixed(2) + " が範囲外のため 0.01〜256 に丸めました"
      );
    });

    const lastTick = events.length > 0 ? events[events.length - 1].tick : 0;
    const durationSec = MMS.ticksToSeconds(project.totalTicks, project.tempoMap, division);

    return { events: events, warnings: warnings, lastTick: lastTick, durationSec: durationSec };
  };

  function round3(x) {
    return Math.round(x * 1000) / 1000;
  }

  /**
   * .mcfunction ファイル一式を生成する。
   * @returns {{setup, start, stop, tick}}
   */
  MMS.buildMcfunctions = function (project, settings) {
    const r = MMS.applySettings(project, settings);
    const OBJ = "ms.time";
    const TICK = "ms_tick";
    const PLAY = "ms_play";

    const setupLines = ["# Milli Music Studio で自動生成（setup）", "# ワールドで一度だけ実行: /function play/setup", "scoreboard objectives add " + OBJ + " dummy", ""];
    const startLines = [
      "# Milli Music Studio で自動生成（start）",
      "scoreboard players set " + PLAY + " " + OBJ + " 1",
      "scoreboard players set " + TICK + " " + OBJ + " -1",
      "",
    ];
    const stopLines = ["# Milli Music Studio で自動生成（stop）", "scoreboard players set " + PLAY + " " + OBJ + " 0", ""];

    const head = [
      "# Milli Music Studio で自動生成（tick）",
      "# tick.json により毎tick実行される。演奏中のみ動作する。",
      "execute if score " + PLAY + " " + OBJ + " matches 1 run scoreboard players add " + TICK + " " + OBJ + " 1",
    ];
    const bodyPitch = r.events.map(function (e) {
      return (
        "execute if score " +
        PLAY +
        " " + OBJ + " matches 1 run execute if score " +
        TICK +
        " " + OBJ + " matches " + e.tick +
        " run playsound " + e.sound + " @a ~ ~ ~ 1 " + round3(e.pitch)
      );
    });

    const lastLine = settings.loop
      ? "execute if score " + PLAY + " " + OBJ + " matches 1 run execute if score " + TICK + " " + OBJ + " matches " + (r.lastTick + 1) + " run scoreboard players set " + TICK + " " + OBJ + " -1"
      : "execute if score " + PLAY + " " + OBJ + " matches 1 run execute if score " + TICK + " " + OBJ + " matches " + (r.lastTick + 1) + " run scoreboard players set " + PLAY + " " + OBJ + " 0";

    const tickLines = head.concat(bodyPitch, [lastLine, ""]);

    return {
      setup: setupLines.join("\n"),
      start: startLines.join("\n"),
      stop: stopLines.join("\n"),
      tick: tickLines.join("\n"),
      summary: r,
    };
  };

  /* =========================================================
   * リソースパック生成
   * ========================================================= */

  MMS.buildSoundsJson = function (project) {
    const defs = {};
    project.parts.forEach(function (part) {
      defs[part.sound] = {
        category: "music",
        sounds: [{ name: "sounds/" + String(part.sound).split(".").pop(), stream: true }],
      };
    });
    return JSON.stringify({ sound_definitions: defs }, null, 2);
  };

  MMS.buildManifest = function (type, name) {
    const isRp = type === "resources";
    return JSON.stringify(
      {
        format_version: 2,
        header: {
          name: name + (isRp ? " RP" : " BP"),
          description: "Milli Music Studio generated " + type + " pack",
          uuid: MMS.uuid(),
          version: [1, 0, 0],
          min_engine_version: [1, 20, 0],
        },
        modules: [{ type: type, uuid: MMS.uuid(), version: [1, 0, 0] }],
      },
      null,
      2
    );
  };

  /* =========================================================
   * ZIP（STORE方式・圧縮なし）書き出し
   * ========================================================= */

  const CRC_TABLE = (function () {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) {
      c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  function utf8Bytes(str) {
    return new TextEncoder().encode(str);
  }

  /**
   * 複数のファイルからZIP（STORE方式）を生成する。
   * @param {Array<{name: string, data: string|Uint8Array}>} files
   * @returns {Uint8Array}
   */
  MMS.buildZip = function (files) {
    const chunks = [];
    const central = [];
    let offset = 0;

    files.forEach(function (f) {
      const bytes = typeof f.data === "string" ? utf8Bytes(f.data) : f.data;
      const nameBytes = utf8Bytes(f.name);
      const crc = crc32(bytes);
      const header = new DataView(new ArrayBuffer(30));
      header.setUint32(0, 0x04034b50, true);
      header.setUint16(4, 20, true); // version needed
      header.setUint16(6, 0x0800, true); // UTF-8 flag
      header.setUint16(8, 0, true); // method: store
      header.setUint16(10, 0, true);
      header.setUint16(12, 0, true);
      header.setUint16(14, 0, true);
      header.setUint32(14, crc, true);
      header.setUint32(18, bytes.length, true);
      header.setUint32(22, bytes.length, true);
      header.setUint16(26, nameBytes.length, true);
      header.setUint16(28, 0, true); // extra len
      chunks.push(new Uint8Array(header.buffer));
      chunks.push(nameBytes);
      chunks.push(bytes);

      offset += 30 + nameBytes.length + bytes.length;
      central.push({ name: f.name, crc: crc, size: bytes.length, offset: offset - (30 + nameBytes.length + bytes.length) });
    });

    const centStart = offset;
    central.forEach(function (c) {
      const nb = utf8Bytes(c.name);
      const cent = new DataView(new ArrayBuffer(46));
      cent.setUint32(0, 0x02014b50, true);
      cent.setUint16(4, 20, true); // version made by
      cent.setUint16(6, 20, true); // version needed
      cent.setUint16(8, 0x0800, true); // UTF-8 flag
      cent.setUint16(10, 0, true); // method: store
      cent.setUint16(12, 0, true); // mod time
      cent.setUint16(14, 0, true); // mod date
      cent.setUint32(16, c.crc, true);
      cent.setUint32(20, c.size, true); // compressed size
      cent.setUint32(24, c.size, true); // uncompressed size
      cent.setUint16(28, nb.length, true);
      cent.setUint16(30, 0, true); // extra len
      cent.setUint16(32, 0, true); // comment len
      cent.setUint16(34, 0, true); // disk number
      cent.setUint16(36, 0, true); // internal attrs
      cent.setUint32(38, 0, true); // external attrs
      cent.setUint32(42, c.offset, true);
      chunks.push(new Uint8Array(cent.buffer));
      chunks.push(nb);
    });
    const centEnd = centStart + central.reduce(function (sum, c) {
      return sum + 46 + utf8Bytes(c.name).length;
    }, 0);

    const eocd = new DataView(new ArrayBuffer(22));
    eocd.setUint32(0, 0x06054b50, true);
    eocd.setUint16(4, 0, true);
    eocd.setUint16(6, 0, true);
    eocd.setUint16(8, files.length, true);
    eocd.setUint16(10, files.length, true);
    eocd.setUint32(12, centEnd - offset, true);
    eocd.setUint32(16, centStart, true);
    eocd.setUint16(20, 0, true);
    chunks.push(new Uint8Array(eocd.buffer));

    const total = chunks.reduce(function (s, c) {
      return s + c.length;
    }, 0);
    const out = new Uint8Array(total);
    let o = 0;
    chunks.forEach(function (c) {
      out.set(c, o);
      o += c.length;
    });
    return out;
  };

  /* =========================================================
   * その他ユーティリティ
   * ========================================================= */

  MMS.uuid = function () {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  };

  MMS.formatSeconds = function (sec) {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return m + ":" + (s < 10 ? "0" : "") + s;
  };

  return MMS;
});