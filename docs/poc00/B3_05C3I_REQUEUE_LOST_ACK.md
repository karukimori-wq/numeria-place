# 応答消失後の運用再開操作の再送検証

記録日：2026-10-27 JST

コード: b0657534c1485d057be9c594db2317bc12c66101
Actions: https://github.com/karukimori-wq/numeria-place/actions/runs/40342934055

## 結果
固定Mercurビルド・型検査成功。3 suites / 45 tests PASS、最終ログ確認済み。既存HTTPケース拡張のため件数増加なし。
Chromiumで実サーバーへのPOSTを処理した後、ブラウザへの応答を遮断。操作用トークンを再入力して再送し、2要求の本文が同一、監査が1件、キューの追加枠が1回のみとなることを確認。

## 実装
- poc/mercur-integration/api/review.html：操作ID・注文・期待試行回数・追加枠をページ内メモリへ保持。通信失敗／5xxでは保持し、対象・追加枠・閲覧更新を停止。同じ要求を再送。トークンは保持しない。
- poc/mercur-integration/http/np-source-checkout.spec.ts：応答遮断と同一要求再送を検証。

## 制限
ページ閉鎖・再読込を跨ぐ復旧は未実装。全てのHTTPエラーや認証切れ後の再開を検証したものではない。本番Clerk・権限運用・監査改ざん耐性・定期ワーカー・実Stripe・NS配送・G0は未完了。
次工程は結果不明中の権限取消／認証切れ後の照合と、ページ再読込時の安全な復旧。
Draft PR #2維持。main・本番・実資金移動なし。
