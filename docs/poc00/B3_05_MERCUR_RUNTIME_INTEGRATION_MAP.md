# PoC 00-B3-05｜Mercur固定SHAの実装接続点と二重送金リスク（初期調査）

**日付：** 2026-10-23
**Mercur pinned SHA：** `9fe557067193e0ad4dd3b7fd37e212f0b352ab3c`
**状態：** ソース実査のみ。Mercur本体への登録・HTTP動作確認・Stripe実決済は未実施。

## 確認した実ファイル

- `apps/api/medusa-config.ts`：`withMercur({... modules:[...]})`でMercur構成。現状、Numeria専用Payment Provider／Payout Providerの登録はない。
- `packages/core/src/api/hooks/payment/[provider]/route.ts`：Medusa標準の`/hooks/payment/:provider`をMercurが上書きし、`PaymentWebhookEvents.WEBHOOK_RECEIVED`をイベントバスへ送る。遅延／再試行設定が存在。
- `packages/core/src/subscribers/payment-webhook.ts`：イベントバスの受信後、`Modules.PAYMENT.getWebhookActionAndData`で検証・解釈し、`processPaymentWorkflowId`へ渡す。B3-04b独立DB処理との二重更新を避ける入口設計が必要。
- `packages/core/src/subscribers/split-order-payment-captured.ts`：`PaymentEvents.CAPTURED`で`splitCapturedCartPaymentWorkflow`を実行。1注文1商品／Direct chargesと整合するか検証必須。
- `packages/core/src/workflows/payment/workflows/split-order-payments.ts`：カート決済を複数注文へ分割し、order payment/captureを生成する標準処理。NPの1注文1商品モデルでは停止・置換または条件分岐が必要。
- `packages/core/src/workflows/payout/workflows/create-payout.ts`：`createPayoutStep`を呼び出し、出店者口座を元にpayoutを生成。
- `packages/core/src/workflows/payout/steps/create-payout.ts`：`PayoutModuleService.createPayouts`へ接続。
- `packages/core/src/modules/payout/services/payout-module-service.ts`：Payout Providerへの実処理経路。
- `packages/core/src/modules/payout/loaders/provider.ts`：設定されたProviderをロード。未指定時は`SystemPayoutProvider`を登録するため、単に設定省略しても「送金機能停止」の証明にならない。

## B3-05の実装方針（未実装）

1. pinned SHAを基準に、MercurのMedusa Payment Provider拡張点と`@mercurjs/core`のPayout Provider登録を確認。
2. NP Direct chargesに対応する専用Payment ProviderとWebhook入口を単一化し、DB確定処理とMercur標準`processPaymentWorkflowId`の重複を回避。
3. NP注文では`splitCapturedCartPaymentWorkflow`を起動させない条件を設けるか、独立した注文決済ワークフローを採用する。
4. `createPayoutWorkflow`／`createPayoutStep`／`createPayouts`／Payout Providerの各経路で、Direct chargeの注文が**Stripe Transferを呼べない**ことを試験で証明する。単にProviderが例外を投げるだけでは正常な運用設計にならない。
5. 本物のMercurアプリでProvider登録、型チェック、起動、HTTP署名検証、DB更新、旧Transfer禁止の回帰試験を追加。
6. Stripe Connect Test Modeの課金・返金・手数料・口座別処理を別ゲートで検証。

## 今回の終了判定

**B3-05のソース接続点調査は着手・記録済み。Mercur本体への統合、旧Transfer停止、実Stripe決済、G0は未完了。** mainと本番は変更しない。
