# PoC 00-B3-04a｜決済予約・障害復旧・Stripe再試行の安全性

更新日：2026-10-22
対象：`karukimori-wq/numeria-place` Draft PR #2、`poc/stripe-direct-security-00`
判定：**独立したPostgreSQL＋模擬Stripe結合試験合格。Mercur実登録／Stripe Test Mode／G0は未合格。**

## 今回の変更

- `poc/mercur-direct/db/b3-checkout-schema.sql`：`np_poc_b3_checkout_attempts`を追加。セッション単位で注文・出店者・Connect account・金額・手数料・通貨・idempotency keyをStripe呼出前に永続化。
- `poc/mercur-direct/src/postgres-checkout-attempt-coordinator.ts`：DBによる予約の取得、90秒の排他リース、12時間以内の同一キー再試行、期限切れ後の`review`状態移行、Stripe応答後のPaymentIntent紐づけを実装。
- `poc/mercur-direct/src/numeria-direct-payment-provider.ts`：Stripe create前に予約を必須化。すでに紐づいたintentはStripe retrieveで再利用し、新規作成しない。
- `poc/mercur-direct/test/checkout-recovery.test.ts`：本物の使い捨てPostgreSQL 15と決定的な模擬Stripe transportを使い、並列・応答消失・DBコミット障害・期限切れ・不正lease・注文スナップショット変更を検証。
- `.github/workflows/poc00-b3-postgres-resolver.yml`：B3-03回帰とB3-04a障害復旧テストを別プロセスで順次実行。

## 合格した実測

1. [B3-04a PostgreSQL CI：20/20 PASS（14回帰＋6障害試験）](https://github.com/karukimori-wq/numeria-place/actions/runs/39714715943)
2. [B3-02 Payment Provider CI：11/11 PASS](https://github.com/karukimori-wq/numeria-place/actions/runs/39714716002)
3. 同一sessionへの8件の並列試行中、DBの排他リースにより模擬Stripe createは1件のみ。完了後の再実行は保存済みintentを取得。
4. Stripe側でintentが作成済みなのにAPI応答が失われた場合、リース期限後に**同じ**Stripe idempotency keyを使い再試行。模擬Stripe上のintent数は増えない。
5. Stripe create成功後にDB紐づけが失敗しても、同じキーで再試行して紐づけを復旧。
6. 12時間を超えた未確定予約は`review`へ移行し、Stripe APIへの自動再要求を拒否。
7. 誤ったリーストークンによるPaymentIntent確定はDBトランザクションでロールバック。
8. 決済予約後に注文の金額が変更された場合、予約スナップショット不一致として拒否。

## 安全性と制約

- **Stripe APIは模擬**。テストでは本物のPostgreSQL 15を使ったが、Stripeの本物のConnectアカウント、課金・返金・Webhook・異議申立ては使用していない。
- 90秒リースはStripe API応答・ネットワークタイムアウトを考慮したPoC値。実運用での適切なタイムアウト、ワーカー再実行、キュー設計は未検証。
- 12時間制限はStripe idempotency keyが将来破棄される可能性を考慮した保守的なPoC制限。Stripeがその間必ずキーを保持することを実Stripeで検証したわけではない。
- Stripe create後のDB障害が12時間を超えた場合、**自動解消せず要照合**。実Stripe APIを使う手動・自動照合機構は未実装。
- 決済予約中にsellerやorderの情報がUPDATEされるのをDBが禁止する不変性制約は未実装。現段階は予約スナップショット比較による拒否。
- Providerは実Mercur runtimeに登録されておらず、Mercur標準Transferが本番で停止することは証明していない。
- B2の署名付きWebhook＋DB Inbox/Outboxと今回の予約／PaymentIntent Registryは**まだ統合されていない**。
- 返金の累積上限、返金ごとの一意キー、手数料返却率、買い手認可、NP FULL_POSTPAYの全文閲覧とPDF権限は別試験。
- AWS隔離環境と本番鍵は一切使用していない。mainへのマージなし。

## 次のB3-04b受入条件

- Stripe署名検証済みWebhook→PaymentIntent Registry→同一DBトランザクション内のInbox／注文更新／Outboxを統合。
- 他sellerの`event.account`、違うPaymentIntent、金額不一致、同一eventID・異なるeventIDの重複、順不同イベントを拒否・冪等処理。
- Stripe Test Modeで実Connected Accountを使用したDirect Charge、返金・手数料を別途検証。
- Mercur実体のProvider登録と標準Transferの停止を実証するまでは正式採用しない。

**G0／本番公開：保留。**
