/* テスト用MIDIファイル（SMF形式）ジェネレーター */

function vlq(n) {
  const out = [];
  let buffer = n & 0x7f;
  while ((n >>= 7) > 0) {
    buffer <<= 8;
    buffer |= (n & 0x7f) | 0x80;
  }
  while (true) {
    out.push(buffer & 0xff);
    if (buffer & 0x80) buffer >>= 8;
    else break;
  }
  return out;
}

function metaEvent(delta, type, data) {
  const bytes = [0xff, type].concat(vlq(data.length), data);
  return [delta].concat(bytes);
}

function midiEvent(delta, status, a, b) {
  if (b === undefined) return [delta, status, a];
  return [delta, status, a, b];
}

function buildMidi(tracks, division) {
  const header = [0x4d, 0x54, 0x68, 0x64, 0x00, 0x00, 0x00, 0x06, 0x00, 0x01, tracks.length >> 8, tracks.length & 0xff, division >> 8, division & 0xff];
  const chunks = [header];
  tracks.forEach((events) => {
    const body = [];
    events.forEach((ev) => {
      body.push.apply(body, vlq(ev[0]));
      for (let i = 1; i < ev.length; i++) body.push(ev[i]);
    });
    const len = [body.length >> 24 & 0xff, body.length >> 16 & 0xff, body.length >> 8 & 0xff, body.length & 0xff];
    chunks.push([0x4d, 0x54, 0x72, 0x6b].concat(len, body));
  });
  const flat = [].concat.apply([], chunks);
  return new Uint8Array(flat);
}

/**
 * テスト用MIDI: 2トラック
 * - トラック1 (ch0): C4 E4 G4 を4分音符で。テンポ変更(120→60BPM)をtick1920に。
 *   一部はnote_on vel 0（note-off扱い）を使用し、ランニングステータスも使用。
 * - トラック2 (ch2): A3 8分音符×4。最後の音はtrack末尾で閉じる（未終了ノートのテスト）。
 */
function createTestMidi() {
  const D = 480; // PPQ
  // トラック1: tempo + タイムシグネチャ + メロディ
  const t1 = [
    metaEvent(0, 0x58, [4, 2, 24, 8]),      // 4/4
    metaEvent(0, 0x51, [0x07, 0xa1, 0x20]), // tempo 500000us = 120BPM
    midiEvent(0, 0x90, 60, 100),            // C4 on
    midiEvent(D, 0x80, 60, 64),             // off
    midiEvent(0, 0x90, 64, 100),            // E4 on (running status省略: 明示)
    midiEvent(D, 0x90, 64, 0),              // note_on vel0 = off
    midiEvent(0, 0x90, 67, 100),            // G4 on
    midiEvent(D, 0x80, 67, 64),             // off
    metaEvent(D, 0x51, [0x0f, 0x42, 0x40]), // tempo 1000000us = 60BPM @ tick1920（休符分のdelta付き）
    midiEvent(0, 0x90, 72, 90),             // C5 on (tick1920, 60BPM区間の1音目)
    midiEvent(D, 0x80, 72, 64),             // off @2400
    midiEvent(0, 0x90, 74, 90),             // D5 on @2400
    midiEvent(D, 0x80, 74, 64),             // off @2880
    metaEvent(0, 0x2f, []),
  ];
  // トラック2: 8分音符 4つ + 最後の音は閉じない
  const t2 = [
    metaEvent(0, 0x03, [0x4d, 0x65, 0x6c, 0x6f, 0x64, 0x79, 0x32]), // track名 "Melody2"
    midiEvent(0, 0x92, 57, 80),           // A3 on ch2
    midiEvent(240, 0x82, 57, 64),         // off
    midiEvent(0, 0x92, 57, 80),           // running statusテスト: status省略
    midiEvent(240, 0x80, 57, 64),         // ch0へ切り替えでoff（他chのnote offは無視される）
    midiEvent(0, 0x92, 57, 80),
    midiEvent(240, 0x92, 57, 0),          // vel0 = off
    midiEvent(0, 0x92, 57, 80),           // 閉じないノート（track endで強制クローズ）
    metaEvent(0, 0x2f, []),
  ];
  return buildMidi([t1, t2], D);
}

module.exports = { createTestMidi, buildMidi, vlq };