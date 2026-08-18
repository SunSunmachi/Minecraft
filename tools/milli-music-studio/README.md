# Milli Music Studio（MMS）

楽曲データを **Minecraft Bedrock Edition 用の音楽データ**（`/playsound` コマンド群）に変換する制作支援ツール。

- 依存ゼロのHTML＋JavaScript。**ファイルを開くだけで動く**（インターネット不要）
- Chromebook / iPhone / Windows / Mac どこでも動作（ブラウザがあればOK）

## 動かし方（Chromebook）

1. `index.html` と `mms-core.js` を**同じフォルダ**に置く
2. `index.html` をダブルクリック（ブラウザで開く）

※ 学校Chromebookで開けない場合は、GitHubのCodespacesからポート転送で開く方法もあります。

## 基本の使い方

```
1. 「MIDI読み込み」で MIDIファイル(.mid)を選ぶ（またはドラッグ＆ドロップ）
2. 音符エディタで確認・修正（▶再生で音を確認できる）
3. 「音色設定」でパートごとに鳴らすサウンド名を決める
4. 「変換設定」で移調・音域などを調整
5. 「出力」で変換 → ZIPでダウンロード
6. ZIPを解凍 → フォルダを .mcpack にリネーム → Minecraftに取り込む
```

### MIDIファイルをどう用意するか

- **REAPER などで自分で作る**（おすすめ・著作権安全）：REAPERで音符を入力し「MIDI書き出し」で保存。GarageBand（iPhone無料）でも作れます。
- **ネット上の配布MIDIを使う**：配布サイトからダウンロード。楽曲によっては権利に注意。
- **後から手入力**：MIDIがなくても、エディタで音符をダブルクリックして追加できます。

## 音符エディタの操作

| 操作 | 内容 |
|---|---|
| ダブルクリック | 音符を追加（グリッドにスナップ） |
| ドラッグ | 音符を移動（音程＋時間） |
| 右端をドラッグ | 音符の長さを変更 |
| 空白をドラッグ | 画面スクロール |
| ホイール | ズーム |
| Delete | 選択中の音符を削除 |
| ▶再生 | Web Audioで試聴（ゲーム内ではなく確認用） |

## 出力されるもの

| ファイル | 役割 |
|---|---|
| `RP/manifest.json` | リソースパック定義 |
| `RP/sounds.json` | カスタムサウンド定義（`ms.sound.xxx`） |
| `RP/sounds/` | **ここにサンプル音源を置く**（例: `sounds/melody.ogg`） |
| `BP/manifest.json` | ビヘイビアパック定義 |
| `BP/functions/play/setup.mcfunction` | スコアボード初期化（**ワールドで一度だけ実行**） |
| `BP/functions/play/start.mcfunction` | 演奏開始 |
| `BP/functions/play/stop.mcfunction` | 停止 |
| `BP/functions/play/tick.mcfunction` | 毎tick実行される演奏本体 |
| `BP/tick.json` | tick関数の自動実行設定 |

### 仕組み

- スコアボード `ms.time` の `ms_tick` を毎tickカウントアップし、音符のタイミングに一致したtickで `playsound` を鳴らす
- `playsound` の pitch 引数（0.0〜256.0）でピッチを変換 → **音ブロック不要・全音域対応**
- テンポ変更（テンポマップ）にも対応

### Minecraftでの使い方（iPhone）

1. ZIPを解凍し、`◯◯_RP` と `◯◯_BP` をそれぞれ `.mcpack` にリネーム
2. iPhoneに送って開く → Minecraftに取り込まれる
3. ワールド設定でリソースパックとビヘイビアパックの両方を適用
4. ワールド内で `/function play/setup`（一度だけ）→ `/function play/start`

## サンプル音源について

`RP/sounds/` に置く音源は各自で用意してください。おすすめは Minecraft の効果音ファイル（.ogg）。

- 音源の元の音程を「音色設定」の**基準音**（デフォルト C4=60）に合わせる
- 長い音符には.ogg（ストリーミング）推奨
- pitchで音程を変える＝再生速度も変わるので、**長く伸ばしたい音は専用ファイル**を作ると良い

## 開発者向け

```
node test/run-tests.js    # コアロジックのテスト（依存ゼロ）
npm i jsdom && node test/smoke-test.js   # UIスモークテスト（jsdom必要）
```

- `mms-core.js`：MIDIパーサー・変換ロジック（ブラウザとNode両対応）
- `index.html`：UI本体
- `test/sample.mid`：動作確認用のサンプルMIDI

## 今後の予定（v2）

- 音声ファイル（mp3/wav）からの自動採譜（主メロ・ビート抽出）— essentia.js を同梱予定
- パーティクル・カメラ演出のタイムライン出力
