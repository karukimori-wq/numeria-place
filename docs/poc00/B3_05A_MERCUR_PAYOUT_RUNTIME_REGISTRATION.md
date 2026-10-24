# PoC 00-B3-05a｜Mercur実Payout Module登録・Direct charges二重送金遮断

**日付:** 2026-10-22
**固定Mercur SHA:** `9fe557067193e0ad4dd3b7fd37e212f0b352ab3c`
**NP対象:** Draft PR #2／`poc/stripe-direct-security-00`
**状態:** CI実機検証中。**Stripe実課金、Mercur Payment Provider統合、G0は未完了。**

## 1. 固定Mercurの実ソース調査

| Mercurの実ファイル | 確認結果・危険点 |
| --- | --- |
| `apps/api/medusa-config.ts` | `withMercur`でmodulesを設定。現状はNP専用Payment／Payout Providerを未登録 |
| `packages/core/src/with-mercur.ts` | アプリのmodules配列を保持し、core pluginを登録する拡張点 |
| `packages/core/src/modules/payout/loaders/provider.ts` | `moduleProviderLoader`を使い、provider識別子でDIコンテナへ登録 |
| `packages/core/src/modules/payout/services/provider-service.ts` | 登録済みPayout Providerが**正確に1個**でなければエラー |
| `packages/core/src/modules/payout/services/payout-module-service.ts` | `createPayouts`→`payoutProviderService_.createPayout`。失敗時は作成したPayout行を削除する設計 |
| `packages/core/src/workflows/payout/workflows/create-payout.ts` | 売上－手数料で`createPayoutStep`を呼ぶ。Direct chargesに流用すると二重送金の危険 |
| `packages/core/src/workflows/payout/steps/create-payout.ts` | `payoutService.createPayouts`を呼ぶ |
| `packages/providers/payout-stripe-connect/src/services/stripe-connect.ts` | `stripe_.transfers.create`を呼ぶ**実送金コード**がある |
| `packages/providers/payout-stripe-connect/src/index.ts` | `ModuleProvider(Modules.PAYMENT,...)`と記載。Payout Module用の意図と一致するか、上流の登録方式の実機確認が必要 |
| `packages/core/src/api/hooks/payment/[provider]/route.ts` | rawBodyをEventBusに積む非同期Webhook入口 |
| `packages/core/src/subscribers/payment-webhook.ts` | Payment Module経由でWebhook解釈→`mercur-process-payment` |
| `packages/core/src/workflows/payment/workflows/process-payment.ts` | 署名検証後のイベントからMercurのカート／split order確定に接続 |
| `packages/core/src/api/hooks/payout/route.ts` | Payout Provider用の別Webhook入口 |
| `packages/core/src/subscribers/payout-webhook.ts` | Payout Accountの有効化等のイベント処理 |
| `apps/api/src/jobs/` | 固定SHAではREADMEのみ。payout実行の定期ジョブは同梱されていない |
| `apps/api/src/subscribers/` | 固定SHAではREADMEとstorefront cache subscriber。payout.requested subscriberは同梱されていない |

**重要:** 同梱ジョブがないことは安全の保証ではない。管理者、追加プラグイン、後日の更新が`createPayoutWorkflow`／`createPayouts`を呼ぶ可能性がある。最終的に実Payout Providerが常にTransferを拒否し、別のStripe Transfer providerを登録しない必要がある。

## 2. 今回作成したNPオーバーレイ

- `poc/mercur-integration/provider/index.ts`：`ModuleProvider(MercurModules.PAYOUT,...)`としてNP専用Providerを登録するテスト用モジュール。
- `poc/mercur-integration/scripts/install-overlay.mjs`：固定Mercurの`integration-tests/medusa-config.ts`に**テスト環境だけ**Payout Providerを登録。既存Mercur本体のソースをGitHub上で変更しない。
- `poc/mercur-integration/http/np-no-transfer-payout.spec.ts`：本物のMercur Payout Module DIで`createPayout`が拒否され、`createPayouts`でも送金成功として保存されないことを検証する統合テスト。
- `poc/mercur-integration/scripts/audit-pinned-mercur.mjs`：固定SHA、上流送金呼出経路、Provider登録、標準Stripe Transfer provider不使用、NP Providerのfail-closedを静的監査。新しいapp-level payoutトリガーが出現すれば停止。
- `.github/workflows/poc00-b3-mercur-payout-registration.yml`：固定Mercurをビルドし、使い捨てPostgreSQL 15・Redis 7とNPオーバーレイで実DI試験。Stripe鍵は合成文字列、API通信なし。

## 3. 検証ゲート

- [ ] Mercur固定SHAのビルド、NP Payout Provider実DI、PayoutService拒否をGitHub ActionsでPASS確認。
- [ ] Mercur Payment Provider（Direct PaymentIntent）の実DI・HTTPルート統合。
- [ ] Stripe Webhook署名検証→Mercur HTTP入口→NP PostgreSQL Inbox/Outboxの一元化。
- [ ] 1注文1商品制約を実Mercurカートに適用。
- [ ] 本物のStripe Connect Test Modeのcharge、application fee、refund、Transferゼロを検証。
- [ ] 既存Mercur PaymentEvents/CAPTURED、split-orderの処理とNP Intakeが二重に注文を確定しないことを検証。
- [ ] AWS・KYC・購入者認可・FULL_POSTPAY納品制御・本番監査。

**判定:** 現時点では本番適用不可。mainへのマージ、実決済、G0は保留。
