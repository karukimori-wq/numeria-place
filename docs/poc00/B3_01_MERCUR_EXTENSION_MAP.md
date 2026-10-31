# PoC 00-B3-01｜Mercur固定版の決済拡張点・送金経路調査

調査日: 2026-10-22  
対象 upstream: [mercurjs/mercur @ 9fe557067193e0ad4dd3b7fd37e212f0b352ab3c](https://github.com/mercurjs/mercur/tree/9fe557067193e0ad4dd3b7fd37e212f0b352ab3c)  
対象NP: `poc/stripe-direct-security-00`（Draft PR #2）  
判定: **B3-01 コード調査完了。B3-02〜実装・実決済未着手。**

## 1. 決済の起点・登録箇所

| 機能 | 固定版の参照箇所 | 確認した事実とNP変更案 |
|---|---|---|
| Medusa起動設定 | `apps/api/medusa-config.ts:8-84` | `withMercur({ modules: [...] })`で構成。現状のアプリ設定にDirect用Payment Provider登録はない。**新規Payment Provider**を`@medusajs/medusa/payment`の`providers`に登録する拡張が必要。既存のPayout Providerと混同しない。 |
| Mercur Payout Providerのローダ | `packages/core/src/modules/payout/loaders/provider.ts:14-47` | Payout Providerは`payout_`キーでDI登録される別モジュール。Payment Providerの登録場所ではない。 |
| Payout Providerの単一性 | `packages/core/src/modules/payout/services/provider-service.ts` | Providerは**ちょうど1つ**でないと起動失敗。既存Stripe Connect Payout Providerと試作の同時登録はできない。 |
| Payout Service | `packages/core/src/modules/payout/services/payout-module-service.ts:164-200` | `createPayouts`からProviderの`createPayout`を呼ぶ。Direct用Providerの`throw`は最後の防御策にすぎず、正常な売上消込ではない。 |
| 既存Stripe Transfer | `packages/providers/payout-stripe-connect/src/services/stripe-connect.ts:147-162` | `stripe.transfers.create`を直接実行。**Direct注文で呼ばせないことが必須**。 |

## 2. 注文・Webhook・返金の経路

| 経路 | 固定版の参照箇所 | 検証・変更対象 |
|---|---|---|
| Payment Webhook HTTP | `packages/core/src/api/hooks/payment/[provider]/route.ts:11-44` | 生bodyとheadersをイベントバスへ送る。ルート自身は署名検証しない。**Payment Provider側で実署名検証**し、Connected Accountを注文に照合する。 |
| Webhook subscriber | `packages/core/src/subscribers/payment-webhook.ts:24-59` | `getWebhookActionAndData`→`processPaymentWorkflow`。session_idがないイベントは無視。 |
| Payment workflow | `packages/core/src/workflows/payment/workflows/process-payment.ts:38-200` | AUTHORIZE/CAPTURE後に`completeCartWithSplitOrdersWorkflow`。Direct chargeのaccountとpayment sessionの永続マッピングが必要。 |
| Split-order payments | `packages/core/src/workflows/payment/workflows/split-order-payments.ts:55-217` | **同一チャージを複数注文へ論理分配する機構**。NPは1注文1商品・1出店者なので、複数seller混在カートを**作成時から拒否**。分割注文機構をDirect chargeの複数出店者配分に流用しない。 |
| CAPTURED subscriber | `packages/core/src/subscribers/split-order-payment-captured.ts:9-31` | Capture後に注文別Payment Collectionを生成する。Direct用providerに影響がないか回帰テスト。 |
| Seller refund API | `packages/core/src/api/vendor/payments/[id]/refund/route.ts` | Medusaの`refundPaymentWorkflow`へ渡す。Refund時は**元の連結アカウント文脈**でStripe API実行が必要。 |
| Payment hooks | `packages/core/src/workflows/payment/workflows/payment-hooks.ts` | MercurのMedusaパッチに依存。固定SHAを変える場合はフック互換性の再確認が必要。 |

## 3. 重要な実装上の判断

1. **Payment Provider と Payout Providerは別。** 前工程の`NumeriaDirectNoTransferProvider`はPayout用で、Checkout／capture／refundの実処理を実装していない。B3-02でMedusaの`AbstractPaymentProvider`または同版`IPaymentProvider`の実インターフェースを確認し、Payment Providerを別に作る。
2. **Stripe APIのアカウント選択はサーバのみ。** カート内の出店者・商品所有権からConnect Accountを再解決。クライアントが送る`acct_...`、手数料、注文金額は信用しない。
3. **既存Transferを止めるには呼び出し元の特定が必要。** `createPayoutWorkflow`とそのhook/event登録箇所の全参照をMercurワークスペースで検索し、Direct注文の自動起動を停止する。Payout Providerの`throw`のみで「二重送金ゼロ」と宣言しない。
4. **Webhookは認証済みでも照合が必要。** イベントID、Connected Account、PaymentIntent、Payment Session、NP Order、金額、通貨、sellerを同じトランザクションで照合し、重複／順不同／異常時は安全側で停止。
5. **FULL_POSTPAYは別フロー。** 先払いCheckoutの成功前提を後払いの全文閲覧・PDF制限に流用しない。未払いでも全文閲覧できるが、PDFは支払後のみ。出店者への未回収リスクがある。
6. **Stripeのアカウント種別・MoR・application_feeの適法性と対応機能は未承認。** 日本向けConnect仕様・アカウント契約と利用規約を確認してから本物のTest Mode操作を行う。

## 4. 次の作業と合格条件

- [x] B3-01A 起動設定・Payment Webhook・Payment Workflow・Refund API・Payout Provider・Transfer経路を固定SHAで確認。
- [x] B3-01B 「Payment ProviderとPayout Providerの違い」「split-orderを1 seller制約の代わりに使わない」ことを明文化。
- [ ] B3-01C **createPayoutWorkflow全参照・自動起動フック**を全ファイル横断検索で特定し、起動禁止を確認（現段階では呼び出し元が未確定）。
- [ ] B3-02 Medusa 2.21.2のPayment Provider実インターフェースを取得し、NP Direct Payment Providerの最小コードを追加。
- [ ] B3-03 checkout session→connected account→PaymentIntentを永続化し、実PostgreSQL上の1 seller制約をテスト。
- [ ] B3-04 MercurのHTTP統合試験でDirect Payment Providerを実登録し、Webhook/capture/refundのテストを追加。
- [ ] B3-05 Stripe Test Modeに実接続し、手数料・返金・Transferゼロを確認。

**完了条件の区別:** B3-01は「拡張点のコード調査」。B3全体とG0は未合格。Stripe API呼出し・Mercur本体改修・本番反映なし。
