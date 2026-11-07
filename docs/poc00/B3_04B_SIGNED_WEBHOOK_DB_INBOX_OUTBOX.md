# PoC 00-B3-04b｜Stripe署名Webhook → PostgreSQL Inbox／注文確定／NS Intake／Outbox

**更新：** 2026-10-22
**対象：** `karukimori-wq/numeria-place` Draft PR #2、`poc/stripe-direct-security-00`
**判定：** 独立PoCは合格。実Stripe API／Mercur実Webhook／NS実配送／G0は未合格。

## 今回実装したもの

1. `poc/mercur-direct/db/b3-webhook-schema.sql`：B3-03/B3-04aと同じPostgreSQL上にInbox、NS Intake、Paid Outboxを追加。eventID、orderID、intentIDに一意制約。
2. `poc/mercur-direct/src/postgres-signed-webhook-processor.ts`：Stripe公式SDK v23でraw bodyと`stripe-signature`を非同期検証した後、`event.account`、PaymentIntent、セッション、注文、seller、JPY金額をDBの正本と照合。
3. 同じDBトランザクションで注文行ロック→Inbox→pendingからpaidへの更新→NS Intake→Paid Outboxを実行。失敗時はすべてROLLBACK。
4. `payment_intent.succeeded`のみpaid確定可能。イベントとPaymentIntentの`succeeded`状態が一致しない場合は拒否。失敗／認可／キャンセルのイベントでは注文のpaid状態を変更しない。
5. 同一eventIDの再送は同じ署名付き本文のハッシュと紐づけを検証し、別内容の再利用は拒否。異なるeventIDで同じ決済が通知されてもNS Intake／Outboxを二重登録しない。
6. `poc/mercur-direct/test/postgres-signed-webhook.test.ts`：本物の使い捨てPostgreSQL 15と、Stripe公式SDKがローカル生成した合成署名イベントを使用。
7. `.github/workflows/poc00-b3-postgres-resolver.yml`：従来のB3-03/B3-04a回帰に加えWebhook統合試験を実行。

## 合格したGitHub Actions

- **[最終CI：32/32 PASS、0 FAIL](https://github.com/karukimori-wq/numeria-place/actions/runs/39716043215)**（B3-03回帰14件＋B3-04a障害復旧6件＋B3-04b署名Webhook12件）。
- 16並列の同一`payment_intent.succeeded`イベントは、paid更新1件、NS Intake1件、Outbox1件。
- 異なるeventIDの同一決済／失敗イベントの前後到着／別出店者account／金額不一致／出店者メタデータ改ざん／未知intent／署名偽装／eventID再利用／途中DB障害を検証。
- イベント種別が`succeeded`でもPaymentIntent状態が`processing`の場合、paid権限を付与しない。
- 初回CIはテスト内変数`process`がNode/Bunの`process.env`を隠したため失敗。変数を`processWebhook`へ変更し、再実行成功。追加の状態一致テストも合格。

## 残る重大な未完了

- Stripe APIは**呼んでいない**。SDKで署名検証しているが、イベントはローカル生成した合成データ。Stripe Connect Test Modeの実送信Webhookは未検証。
- このプロセッサは**Mercur本体のHTTP routeに登録されていない**。既存Medusa ProviderのWebhook処理と重複処理しないよう入口の一本化が必要。
- NS Intake／OutboxはDBに記録しただけ。**Numeria Studioへの実送信、失敗再送、認可、納品は未実施**。
- PaymentIntentのDB登録より先にStripeからWebhookが届く競合は、現在は未登録intentとして拒否。実Webhook endpointでは一時エラー・再送・後続照合を設計する必要がある。
- Webhookイベントの認証環境（test/live）と署名シークレットの分離、配送遅延監視、DLQ、監査、保存期間は未設計。
- 返金・部分返金・application fee調整・Chargeback／紛争・キャンセル時の補償は未実装。
- 注文のseller/account/amount不変性はDBの更新禁止制約まで完成していない。
- Mercur標準Transfer停止の実機検証、Stripe Connectの本人確認・利用可能性、日本向け契約、AWS閉域、購入者認可、FULL_POSTPAY全文閲覧／PDF権限は未完了。

## 次工程：B3-05

1. pinned Mercurアプリの実`medusa-config`にPayment Provider／Payout Providerを登録して型・ビルド・HTTP試験。
2. 標準Payoutのjobs、subscriber、manual API、workflowの全呼出経路を監査し、Direct chargeと旧Transferの二重支払を実機で防止。
3. Webhook入口の一元化と実HTTPの署名・DB処理試験。
4. 実Stripe Connect Test Modeの安全な検証に必要なSecretsはGitHub Actions Secrets等へGUIで設定（**チャット・GitHubソースにキーを記載しない**）。

**本番／main変更なし。Mercur正式採用、G0、Stripe実決済、AWS本番公開は保留。**
