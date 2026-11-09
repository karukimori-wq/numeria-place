# PoC 00-B3-03｜PostgreSQL正本Checkout Resolver・PaymentIntent紐づけ

更新: 2026-10-22  
対象: `karukimori-wq/numeria-place` / Draft PR #2 / `poc/stripe-direct-security-00`  
**判定: 独立したPostgreSQL結合PoC合格。Mercur本体・Stripe実決済・G0は未合格。**

## 実装成果物

| ファイル | 役割 |
|---|---|
| `poc/mercur-direct/db/b3-checkout-schema.sql` | 一時DB上のseller、Connect account、listing、order、session、PaymentIntent正本と制約 |
| `poc/mercur-direct/src/postgres-checkout-resolver.ts` | session IDのみを入力に、注文の出店者・接続先・金額・手数料・通貨をDBから再解決 |
| `poc/mercur-direct/src/postgres-payment-intent-registry.ts` | session IDにつき1つのPaymentIntentをDBに紐づけ、参照時とWebhook時に照合 |
| `poc/mercur-direct/src/numeria-direct-payment-provider.ts` | Providerが上記ResolverとRegistryを必須DIとして利用。決済開始後、Stripe結果をDBに保存してから返答 |
| `poc/mercur-direct/test/postgres-checkout-resolver.test.ts` | PostgreSQL 15とモックStripeを使う14件の結合テスト |
| `.github/workflows/poc00-b3-postgres-resolver.yml` | disposable PostgreSQL 15とBun 1.3.8によるCI |

## CI証跡

- [B3-03 PostgreSQL実DB結合試験：14/14 PASS](https://github.com/karukimori-wq/numeria-place/actions/runs/39713905901)
- [B3-02 Provider単体回帰：10/10 PASS](https://github.com/karukimori-wq/numeria-place/actions/runs/39713905782)
- CIは一時DBであり本番データを使わない。Stripe APIの本物の課金・返金は呼んでいない。
- 開発途中でDDLの破損によるCI失敗を検出し、スキーマを完全に書き直した。**合格は修正版コミット`4e2195e`のCIのみ**。

## 確認した安全性

1. 出店者Aの注文でクライアントが出店者Bのaccountを送っても、DB正本のAへルーティング。注文金額・手数料はDB値。
2. composite FKで別出店者の商品・Connectアカウントを持つ注文をINSERT時に拒否。
3. 1注文につき決済セッション1件の一意制約。
4. seller停止・KYC未完了・charges_enabled=false・未公開商品・期限切れセッションでは**新規決済**を拒否。
5. 既に支払い済みの注文では新規決済を拒否。
6. 一方、支払い済み注文の照合・返金準備は、セッション期限切れや出店者停止後も既存の元アカウントを参照可能。
7. PaymentIntentはsession IDと一意に紐づく。別intentへの差替え、別sellerとしての照合を拒否。
8. 同一セッションの8並列試行は同一Stripe idempotency keyを使用し、DBには1件のPaymentIntentのみ。**実Stripe側の課金が1回であることは未検証**。

## 未完了のセキュリティ/整合性課題

- **StripeのKYC・charges_enabledをリアルタイム再確認していない。** DB上の状態が古い可能性がある。
- Stripe APIでPaymentIntent作成後、DBへ記録するまでの障害ウィンドウがある。Stripe idempotency keyは同一だが、再試行期限を超えると二重課金リスクがある。作成前のDB reservationと障害復旧/reconciliationが必要。
- 出店者・金額・Connectアカウントの注文スナップショットは、DBの参照整合性は確保したが、**UPDATE不可（不変性）**は未実装。
- WebhookイベントIDの永続Inboxと、今回のPaymentIntent Registryを同一トランザクションに統合していない。B2のInbox PoCは独立試験。
- 複数回の部分返金の合計が元決済額を超えないDB制御、返金の個別idempotency key、application fee返却率の照合は未実装。
- 1注文1商品は本PoCの単一listing_id構造で表現。Mercur実際のCart/Line Itemでの制約は未統合。
- `IPaymentProvider`の**実Medusa 2.21.2型チェック**、Mercur runtime登録、Mercur標準Transfer自動起動停止は未検証。
- 署名付きWebhookの暗号検証はB3-02単体試験で確認したが、Webhook→Registry→Inbox→注文確定のE2Eは未検証。
- 購入者・テナント認可、全文閲覧/PDF権限、Cloudflare/AWSネットワーク分離は別ゲート。

## 次の実装：B3-04

**Stripe作成前のDB予約、intent記録失敗時の安全な再試行、署名付きWebhookをDB Inbox/Outboxと一体化、部分返金の累積制御、Mercur本体のPayment Provider登録を順次進める。** 実Stripe Test Modeは接続アカウントの権限・契約と資格情報を確認してから実施する。

**G0とMercur正式採用は保留。** 本番・mainへの変更なし。
