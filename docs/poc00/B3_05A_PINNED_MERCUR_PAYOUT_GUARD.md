# PoC 00-B3-05a｜Mercur旧Payout停止の固定SHAソース監査

更新日：2026-10-23 JST。対象Mercur SHA `9fe557067193e0ad4dd3b7fd37e212f0b352ab3c`、NP Draft PR #2。

## 実装

- `poc/mercur-direct/scripts/apply-direct-payout-guard.cjs`：Git SHA一致を確認したうえで、`packages/core/src/modules/payout/services/payout-module-service.ts`の`createPayouts`へ、**DB行作成とProvider createPayoutの前**に`NP_DIRECT_CHARGES_NO_MERCUR_PAYOUT=true`条件の拒否ガードを挿入。
- `poc/mercur-direct/scripts/audit-mercur-direct-gates.cjs`：Payout service、workflow、step、provider loader、旧Stripe Transfer、Payment webhook、withMercur configの11箇所を固定ソースと照合。
- `.github/workflows/poc00-b3-mercur-payout-guard.yml`：CIでMercurを別チェックアウトしガードを適用、監査を実行。負例ではガードを削除すると監査が失敗することも確認。
- [CI：11/11静的監査合格、負例検出合格](https://github.com/karukimori-wq/numeria-place/actions/runs/39807087910)。

## 固定Mercurで判明した経路

- `apps/api/medusa-config.ts`→`packages/core/src/with-mercur.ts`：module構成の入口。
- `packages/core/src/modules/payout/loaders/provider.ts`：Payout Provider登録。
- `packages/core/src/workflows/payout/workflows/create-payout.ts`→`steps/create-payout.ts`→`modules/payout/services/payout-module-service.ts`：Payout実行経路。
- `packages/providers/payout-stripe-connect/src/services/stripe-connect.ts`：旧`this.stripe_.transfers.create`。
- `packages/core/src/api/hooks/payment/[provider]/route.ts`→`subscribers/payment-webhook.ts`：イベントバス経由の決済Webhook経路。

## 未完了・採用ゲート

- **静的監査のみ**。Mercur実プロセスへのガード適用・起動・DBサービス呼出・Transfer 0件の実証は未完了。
- 新しいDirect Payment Provider／No-Transfer Payout ProviderのMedusa/Mercur実登録、型チェック、HTTP統合試験は別工程。
- B3-04bの署名Webhook/InboxとMercur標準Webhookの入口統一、NS実配送、返金・紛争・手数料照合、実Stripe Test Modeも未完了。
- 移行中はPayout拒否で業務停止するため、正式採用前に読取専用売上照合へ置換が必要。
- **main・本番変更なし。G0・Mercur正式採用は保留。**
