# B3-05c-3h — 運用確認画面（閲覧専用）
2026-10-26

## 変更
使い捨てMercur統合アプリの `/np-ops/review` に日本語の閲覧画面を追加。
NODE_ENV=test のみHTMLを返す。画面自体はデータを含まず、状態取得は既存の user Bearer＋独立運用者grant付きGETを使う。
注文IDはencodeURIComponent、表示はtextContent。認証トークンはpassword欄から一時利用し直ちに消去。localStorage/sessionStorage/cookieへ保存しない。
再読込・拒否時には前の結果を非表示・消去。cache禁止、外部接続・フレーム埋込みをCSPで制限。
状態・試行履歴・監査の直近50件と続きの有無のみ表示。再開POSTは画面から実行しない。

変更ファイル:
- poc/mercur-integration/api/review.html
- poc/mercur-integration/api/review-route.ts
- poc/mercur-integration/scripts/install-direct-runtime.mjs
- poc/mercur-integration/http/np-source-checkout.spec.ts
- .github/workflows/poc00-b3-mercur-source-snapshot.yml

## 検証
既存の実Medusa User/AuthIdentity/JWTを使うHTTP試験内でChromiumを起動し、実サーバーの画面→閲覧GETを通す。
grantなし拒否→grant追加後閲覧→grant取消後拒否、結果非表示、入力消去、Web Storage非保存、JSエラーなしを確認。
375/390/430/768/1440pxで横はみ出し検査と画面キャプチャ。Actions artifact `np-operator-review` へ保存。
既存テスト拡張のため総数は45のまま。

## 未完了
本番Clerk/対話ログイン/権限付与運用、再開確認UI、全履歴ページ送り、監査改ざん耐性、定期ワーカー、部分注文自動修復は未完了。
このpassword入力は検証ハーネスであり本番ログインではない。
実Stripe API・実Webhook配信・NS配送・G0・Mercur正式採用・本番公開は保留。mainマージ、本番反映、実資金移動なし。

## 実行結果
コード: 059ea77ea98f819295a3c39750bb8806e5682d63
Actions: https://github.com/karukimori-wq/numeria-place/actions/runs/40207901013
固定Mercurビルド、型検査、3 suites / 45 tests PASS。既存HTTPケースにブラウザ項目を追加したため件数増加なし。
5幅のPNGはartifact 12604347909（np-operator-review、370476 bytes）に保存。自動レイアウト検査はPASS。人による画像の目視レビューは未実施。
初回はubuntu-latestがUbuntu26.04となりPlaywright1.56.1のbrowser installで失敗。ubuntu-24.04固定後に再実行して成功。
