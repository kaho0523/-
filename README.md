# 遅刻防止アラーム

「電車の時間は分かってるのに、あと10分寝てしまって遅刻する」問題を解決するWebアプリです。

## 機能

- 起きるべき時刻・家を出るべき時刻を自動計算
- 5段階の危険度表示（SAFE → CAUTION → WARNING → DANGER → TOO_LATE）
- カウントダウンタイマー
- アラーム音（Web Audio API）
- ブラウザ通知（Notification API）
- 運行遅延情報表示
- PWA対応（ホーム画面に追加可能）
- localStorageによるデータ保存（ログイン不要）

## セットアップ

```bash
npm install
npm run dev
```

## 環境変数

`.env.local.example` を `.env.local` にコピーして設定：

| 変数名 | 用途 | 必須 |
|--------|------|------|
| `OPEN_AI_KEY` | AIアラートメッセージ生成（gpt-5.4-nano） | 任意 |
| `ODPT_API_KEY` | 東京圏リアルタイム遅延情報 | 任意 |

電車時刻の自動取得は **Yahoo!乗換案内のウェブスクレイピング**で行うため、APIキー不要です。  
`OPEN_AI_KEY` が未設定の場合、アラートメッセージは表示されません。

## APIキーの取得

- **OpenAI**: https://platform.openai.com/api-keys
- **ODPT**: https://developer-tokyometro.jp/ （無料）

## API構成

| エンドポイント | 方式 | 用途 |
|---|---|---|
| `/api/trains` | Yahoo!乗換案内 スクレイピング | 電車時刻の取得（APIキー不要） |
| `/api/alert-message` | OpenAI gpt-5.4-nano | アラートメッセージ生成 |

## 時刻計算ロジック

```
乗る電車 = 到着希望時刻 - 余裕時間 - 目的地駅→目的地 - 乗車時間 に間に合う最終電車
家を出る時刻 = 電車の出発時刻 - 駅までの移動時間
起きる時刻 = 家を出る時刻 - 準備時間
```

## 危険度レベル

| レベル | 条件 | アクション |
|--------|------|-----------|
| SAFE | 出発まで25分以上 | 通常表示 |
| CAUTION | 起床時刻まで20分以内 | 警告表示 |
| WARNING | 出発まで25分以内 | アラーム開始 |
| DANGER | 出発まで10分以内 | 強力なアラーム |
| TOO_LATE | 出発時刻経過 | 最強アラーム |

## Vercelデプロイ

1. GitHubにpush
2. Vercelでリポジトリを接続
3. 環境変数を設定（任意）
4. デプロイ完了

## 技術スタック

- Next.js 14 (App Router)
- TypeScript
- Tailwind CSS
- Web Audio API（アラーム音）
- Notification API（ブラウザ通知）
- Service Worker（PWA）
- localStorage（データ保存）
