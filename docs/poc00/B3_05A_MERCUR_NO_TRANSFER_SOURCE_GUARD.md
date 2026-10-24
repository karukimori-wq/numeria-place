# PoC 00-B3-05a｜Mercur Direct chargesの旧Transfer遮断（ソースレベル）

**日付：** 2026-10-23
**対象：** Numeria Place Draft PR #2、`poc/stripe-direct-security-00`
**固定Mercur SHA：** `9fe557067193e0ad4dd3b7fd37e212f0b352ab3c`
**判定：** pinned Mercurのソースへの遮断パッチ適用と経路検査は合格。実行環境でのProvider登録・HTTP・実Stripe APIは未検証。

## 実装と調査で確定したこと

- [x] Mercurの標準Stripe Connect payout provider `packages/providers/payout-stripe-connect/src/services/stripe-connect.ts`は`this.stripe_.transfers.create(...)`を呼ぶ。Direct chargesで別途Transferすると二重支払いの危険。
- [x] 標準の`createPayoutWorkflow` → `createPayoutStep` → `PayoutModuleService.createPayouts` → `PayoutProviderService.createPayout` → `StripeConnectProviderService.createPayout`の経路を固定SHAで確認。
- [x] `packages/core/src/modules/payout/services/payout-module-service.ts`の`createPayouts`実装を、`NP_DIRECT_CHARGE_MERCUR_TRANSFER_FORBIDDEN`を投げるfail-closed版へ**使い捨てMercurチェックアウト内で差替えるスクリプト**を実装。
- [x] スクリプトは固定SHA一致と正確な関数境界を検査し、異なるupstream版や予期せぬコード変更には適用しない。
- [x] 差替え後にworkflow/step/service/providerの経路と変更ファイルが一つだけであることを自動検査。
- [x] Mercur標準の`transfers.create`はupstream内に残るため、**Providerへの直接アクセスや他の経路がないことの実機検証は別途必要**。

## 検証結果

- [GitHub Actions B3-05a：PASS](https://github.com/karukimori-wq/numeria-place/actions/runs/39810633512)
- [検証スクリプト](https://github.com/karukimori-wq/numeria-place/blob/poc/stripe-direct-security-00/poc/mercur-direct/scripts/verify-mercur-no-transfer-guard.mjs)
- [差替えスクリプト](https://github.com/karukimori-wq/numeria-place/blob/poc/stripe-direct-security-00/poc/mercur-direct/scripts/apply-mercur-no-transfer-guard.mjs)
- [CIワークフロー](https://github.com/karukimori-wq/numeria-place/blob/poc/stripe-direct-security-00/.github/workflows/poc00-b3-mercur-no-transfer-guard.yml)

## 重大な未完了

- [ ] 実Mercur依存関係を導入した型チェック・ビルド、Payout serviceの実行テスト。
- [ ] Payment ProviderとPayout ProviderをMercurの`medusa-config.ts`へ実登録。
- [ ] Mercur標準WebhookとNP署名Webhookの入口の一本化、二重注文処理の排除。
- [ ] すべての手動API、job、subscriber、workflow、サービス直呼び、Stripe SDK直接呼出しの実行経路監査。
- [ ] 実Stripe Connect Test ModeでDirect charge、application fee、返金、送金0件を検証。
- [ ] Mercur実HTTPでのWebhook署名・注文確定、NS配送ワーカー、運用監査。
- [ ] G0、本番公開、mainマージ。

## 次工程：B3-05b

1. 固定Mercurへguardを適用して型チェック／ビルドし、`createPayouts`を直接呼び出すテストで実際に拒否されることを確認。
2. 独立PoCの`NumeriaDirectPaymentProvider`と`NumeriaDirectNoTransferProvider`をMedusa/Mercurのモジュール構成に登録する検証を追加。
3. 旧Transferと新Webhookの経路を統合し、実HTTPとStripe Test Modeに進む。

**本番／main変更なし。Mercur正式採用・G0・実決済は保留。**
