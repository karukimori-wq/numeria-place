# Numeria Place

占い師が鑑定書を販売・納品するマーケットプレイス。**設計・開発準備段階**です。現在、このリポジトリには本番サービスの実装・決済接続・デプロイ設定はありません。

## 設計の入口

- [Numeria Place 仕様書（Notion）](https://app.notion.com/p/3f3e71121fed813eb4f0ea8929168d19)
- [15｜サイト構造・4システム連携](https://app.notion.com/p/3fde71121fed8190b441f5c066edab9f)
- [16｜主要5画面のUI詳細設計](https://app.notion.com/p/3fde71121fed8184a77bfc7ad2b44470)
- [22｜5画面横断監査・Codex引継ぎ](https://app.notion.com/p/3fee71121fed81c6a9f0fad8fb2b50a1)
- [共通契約リポジトリ](https://github.com/karukimori-wq/professional-platform-contracts) ― PR #4 は2026-10-20確認時点で **Draft / 未マージ**。正式採用前の仕様として扱わない。
- 5画面の操作モックと詳細Codex作業指示は、ChatGPT会話の `Numeria_Place_UIUX_CrossScreen_Codex_V1_20261019.zip` に収録。リポジトリへの反映はこれから。

## サービスの原則

1. **一般出店者はNumeria Studio Business不要**。NPだけでショップ、商品、注文、連絡、手動PDF納品、売上・返金を完結できる。
2. **Business連携は追加機能**。NSで鑑定を作成し、NPで販売・閲覧権限・納品を管理。専用LPと通常ショップは**同一listingId/価格/Checkout**。
3. **1注文=1商品=1販売者**。契約上の販売者は各占い師。NPの販売・決済正本をGE/NSに複製しない。
4. **先払い／一部公開後払い／完全後払い**。完全後払いは本人認証済みのWeb全文閲覧を支払前に許可し、**PDFは支払確認後**。
5. **データ責任**：NP＝商品・注文・請求・決済・買い手への公開権限、GE＝連携・横断Projection、NS＝鑑定・正式Report/PDF、APC＝AI生成。
6. **セキュリティ最優先**。他人の注文、相談内容、鑑定書にアクセスさせない。Stripe metadataや公開キャッシュ、業務イベントへ機微情報を載せない。
7. **Business失効時にNP単独販売・既存注文を消さない**。新規NS連携や専用LP編集の権限とは別判定。

## 現状と次の作業

- **G0 実装環境準備**：2026-10-20に空の新規GitHubリポジトリであることを確認。フレームワーク、DB、ホスティング、認証接続、Stripe接続は未設定。
- **G0 Contract/技術決定**：共通Contract、Stripe Connect Direct charges候補とMercur標準方式の差分、後払いの正式規約、Business失効時LPの扱いを検討。
- **P1 UI**：共通デザイントークン・公開商品・購入者トップ・商品詳細・出店者管理・専用LPのモックを、実ルートで接続。
- **P2〜P4**：注文・Clerk認証復帰・Stripeテスト決済・本人限定納品・GE/NS/APC連携。
- **P5**：E2E、スマホ・セキュリティ・アクセシビリティ・運用確認。

開発タスクと受入条件はNotion 22およびCodex指示ZIPを参照してください。**デモ商品・架空の料金・未承認の期日や手数料を本番仕様として実装しないこと。**

## 開発ルール

- 初期は設計参照・環境確認・隔離された実装ブランチから着手。本番設定変更・Stripeライブ決済・本番DB移行・main直接実装は別途合意する。
- 使用フレームワーク、Cloudflare/DB構成、OSSの採否は決定後にここを更新する。
- Codexには [AGENTS.md](AGENTS.md) の安全境界と終了条件を適用する。
