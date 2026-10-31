# PoC 00-B3｜Mercur × Stripe Connect Direct charges 結合実装計画

状態: **設計・実装準備**（実決済は未実施）。対象: `karukimori-wq/numeria-place` Draft PR #2。Mercur本体未統合。

## 固定条件
- 1注文1商品、販売者＝占い師。複数出店者をまたぐカート決済は不可。
- NPがマーケットプレイス注文・決済・手数料・返金の正本。NSは鑑定・レポート正本、GEは連携売上投影。
- Direct charges: Stripe APIの`stripeAccount`指定により連結アカウントでPaymentIntentを作成。プラットフォーム手数料は`application_fee_amount`。手数料・Stripe負担主体・返金時手数料の扱いはStripe Connect契約設定と最新APIで検証。
- 旧Mercurの`transfers.create`を呼ぶパスを停止。PoC B2の`createPayout` throwは二重送金防止の仮措置で、運用可能な売上消込ではない。
- API鍵、Connect ID、Webhook secret、購入者個人情報はリポジトリやCIログに保存しない。

## 実装タスク
- [ ] B3-01 Mercur固定SHAのPayment Provider登録位置、`PaymentIntent`生成・capture・refund・Webhookの拡張点をコード確認し変更箇所を一覧化。
- [ ] B3-02 Checkout時にサーバ側で商品→出店者→連結アカウントを検証。クライアント提供のaccount ID・feeを信用しない。
- [ ] B3-03 1注文1出店者制約。Connectアカウント`charges_enabled`、KYC状態、出店者権限を決済前に再確認。
- [ ] B3-04 Direct charge PaymentIntentを連結アカウントコンテキストで作成。通貨JPY、金額最小単位、プラットフォーム手数料、冪等キー、メタデータの最小化を検証。
- [ ] B3-05 PaymentIntentとNP orderの関連付け、決済Webhook署名・Connectアカウント識別・イベントID重複防止、順不同・再試行・同時処理対応。
- [ ] B3-06 capture / refund / cancelを元のConnected Account文脈で処理し、手数料返却とStripe残高を照合。
- [ ] B3-07 Mercur標準`payout.requested`／`createPayoutWorkflow`／Stripe Transferの自動起動を禁止し、Direct charge売上は読取専用の照合レコードへ置換。過去注文や別決済方式への影響を検証。
- [ ] B3-08 完全後払いは「全文閲覧可、PDFは決済成功後のみ」の権限判定を独立テスト。未払い・失敗・返金時の再閲覧／PDF制御を定義。
- [ ] B3-09 金額不一致、異なる出店者、未認証Webhook、重複・順不同イベント、部分返金、手数料端数、再試行、競合を自動テスト。
- [ ] B3-10 Stripe Test Modeで実Connected Accountを使い、charge・application fee・refund・決済失敗・再試行・Transferゼロを証跡付きで確認。テスト資格情報は安全な環境変数のみ。
- [ ] B3-11 CloudflareフロントとMercur APIの認証・CORS・CSRF・Webhook公開範囲・監査ログ・個人情報保護をレビュー。

## 合格条件
- 実Stripe Test Modeの注文1件が正しい出店者のConnected Accountで決済され、手数料が設定どおり。
- 注文状態が署名済みWebhookから正しく一度だけ確定。
- 返金・キャンセルの金額と状態が一致し、同じイベントを複数回受けても二重返金・二重送金なし。
- Direct chargeに対するMercur Transfer実行がゼロであることを計測・証明。
- 未払い後払いPDFのダウンロード不可。別ユーザー・別テナントから閲覧不可。
- GitHub Actions成功、実決済証跡（機密情報マスク済み）、レビュー承認を揃える。**G0はこれらの完了まで保留。**

## 現時点の証拠
- [Mercur標準HTTP回帰 16/16](https://github.com/karukimori-wq/numeria-place/actions/runs/39537602572)
- [Direct Transfer禁止Provider単体試作 7/7](https://github.com/karukimori-wq/numeria-place/actions/runs/39631848108)
- [Draft PR #2](https://github.com/karukimori-wq/numeria-place/pull/2)

注意: 上記2つのPASSは**本物のConnectアカウントへの課金成功を意味しない**。
