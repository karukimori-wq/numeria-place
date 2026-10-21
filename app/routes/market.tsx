import { useMemo, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router";
import {
  sellers,
  listings,
  orders,
  policyLabels,
  money,
  listingFor,
  sellerFor,
  fixtureGateway,
  fixtureAuth,
  entitlement,
} from "../data.mjs";

export function meta() {
  return [
    { title: "Numeria Place｜架空の体験デモ" },
    {
      name: "description",
      content:
        "鑑定書を選んで受け取るNumeria Placeの架空UIデモ。決済・登録は行われません。",
    },
  ];
}
const modeName = (mode: string) =>
  mode === "AI_ASSISTED_HUMAN" ? "AI補助＋占い師" : "占い師による鑑定";
const paymentLabel = (status: string) =>
  (
    ({
      UNPAID: "未払い",
      PAID: "支払済み",
      OVERDUE: "期限超過",
      VERIFYING: "確認中",
      REFUNDED: "返金済み",
    }) as Record<string, string>
  )[status] || status;
const stepLabel = (status: string) =>
  (
    ({
      NOT_STARTED: "未着手",
      IN_PROGRESS: "鑑定中",
      READY: "鑑定書準備済み",
      COMPLETED: "完了",
    }) as Record<string, string>
  )[status] || status;
const publishedLabel = (status: string) =>
  (
    ({
      NOT_PUBLISHED: "未公開",
      PREVIEW_PUBLISHED: "一部公開",
      FULL_PUBLISHED: "全文公開",
    }) as Record<string, string>
  )[status] || status;
const sectionDescription =
  "この画面は架空の商品・価格・注文による体験デモです。実際の支払い・注文・鑑定は行われません。";

function ButtonLink({
  to,
  children,
  light = false,
}: {
  to: string;
  children: React.ReactNode;
  light?: boolean;
}) {
  return (
    <Link className={light ? "button button-light" : "button"} to={to}>
      {children}
      <span aria-hidden="true"> ↗</span>
    </Link>
  );
}
function DemoFlag() {
  return (
    <div className="demo-banner" role="status">
      <strong>DEMO / 架空</strong>
      <span>実際の購入・ログイン・決済・PDFダウンロードはできません</span>
    </div>
  );
}
function Header({ seller = false }: { seller?: boolean }) {
  return (
    <>
      <DemoFlag />
      <header className="site-header">
        <div className="container header-inner">
          <Link to="/" className="logo" aria-label="Numeria Place ホーム">
            <span className="logo-star">✧</span> Numeria <b>Place</b>
          </Link>
          <nav className="desktop-links" aria-label="メインメニュー">
            <Link to="/explore">鑑定を探す</Link>
            <Link to="/shops/star-notes-demo">占い師を探す</Link>
            <Link to="/me/orders">鑑定書</Link>
            <Link to="/seller">出店者メニュー</Link>
          </nav>
          <Link className="header-action" to={seller ? "/" : "/seller"}>
            {seller ? "購入者ページへ" : "出店者の方へ"} ↗
          </Link>
        </div>
      </header>
    </>
  );
}
function Nav({ seller = false }: { seller?: boolean }) {
  const menu = seller
    ? [
        ["/seller", "⌂", "ホーム"],
        ["/seller/orders", "▤", "注文"],
        ["/seller/items", "◇", "商品"],
        ["/seller/shop", "▧", "ショップ"],
      ]
    : [
        ["/", "⌕", "探す"],
        ["/me/library", "▦", "鑑定書"],
        ["/me/profile", "◯", "マイページ"],
      ];
  return (
    <nav
      className="bottom-nav"
      aria-label={seller ? "出店者ナビ" : "購入者ナビ"}
    >
      {menu.map(([url, icon, label]) => (
        <NavLink
          key={url}
          to={url}
          className={({ isActive }) => (isActive ? "active" : "")}
        >
          <span aria-hidden="true">{icon}</span>
          <small>{label}</small>
        </NavLink>
      ))}
    </nav>
  );
}
function Layout({
  children,
  seller = false,
}: {
  children: React.ReactNode;
  seller?: boolean;
}) {
  return (
    <>
      <a className="skip-link" href="#main">
        本文へ移動
      </a>
      <Header seller={seller} />
      <main id="main" tabIndex={-1}>
        {children}
      </main>
      <footer className="footer">
        <div className="container">
          <span>✧ Numeria Place</span>
          <span>体験デモ：すべて架空の情報です</span>
          <Link to="/sell">出店について</Link>
        </div>
      </footer>
      <Nav seller={seller} />
    </>
  );
}
function SectionTitle({
  eyebrow,
  title,
  sub,
}: {
  eyebrow: string;
  title: string;
  sub?: string;
}) {
  return (
    <div className="section-heading">
      <span className="eyebrow">{eyebrow}</span>
      <h2>{title}</h2>
      {sub && <p>{sub}</p>}
    </div>
  );
}
function ListingCard({ listing }: { listing: (typeof listings)[number] }) {
  const seller = sellerFor(listing);
  return (
    <article className="listing-card">
      <div
        className={
          "listing-art " +
          (listing.category === "タロット" ? "tarot" : "numerology")
        }
      >
        <span className="decor-corner">✧</span>
        <span className="large-symbol">
          {listing.category === "タロット" ? "☽" : "7"}
        </span>
        <span className="art-label">
          {listing.category}　•　{listing.tag}
        </span>
      </div>
      <div className="listing-card-body">
        <div className="card-meta">
          <span>
            {listing.pr ? <b className="pr">PR</b> : null}
            {listing.category}
          </span>
          <span>{modeName(listing.mode)}</span>
        </div>
        <h3>
          <Link to={"/items/" + listing.slug}>{listing.name}</Link>
        </h3>
        <p>
          {seller?.name}{" "}
          <span className="muted">／{listing.days}日目安（デモ）</span>
        </p>
        <div className="card-footer">
          <strong>{money(listing.price)}</strong>
          <Link to={"/items/" + listing.slug} className="text-link">
            詳細を見る　→
          </Link>
        </div>
        <small>
          税込想定の架空価格・
          {policyLabels[listing.policy as keyof typeof policyLabels]}
        </small>
      </div>
    </article>
  );
}
function Home() {
  const [keyword, setKeyword] = useState("");
  const shown = useMemo(
    () =>
      listings.filter((l) =>
        (l.name + " " + l.theme + " " + l.category).includes(keyword),
      ),
    [keyword],
  );
  return (
    <Layout>
      <section className="hero">
        <div className="container hero-grid">
          <div className="hero-copy">
            <span className="eyebrow">YOUR STORY, IN STARS</span>
            <h1>
              あなたの物語に、
              <br />
              <em>新しい光を。</em>
            </h1>
            <p>
              数秘術やタロットから、今の気持ちを整理する。占い師が届ける鑑定書を、あなたのペースで。
            </p>
            <form
              onSubmit={(e) => e.preventDefault()}
              className="search-hero"
              role="search"
            >
              <label htmlFor="hero-search" className="sr-only">
                鑑定を探す
              </label>
              <input
                id="hero-search"
                placeholder="恋愛・仕事・占術から探す"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
              />
              <button
                type="button"
                onClick={() =>
                  document
                    .getElementById("featured")
                    ?.scrollIntoView({ behavior: "smooth" })
                }
              >
                探す →
              </button>
            </form>
            <small className="hero-note">
              占い師が販売者　·　納期と支払条件を確認して依頼
            </small>
          </div>
          <div className="hero-visual" aria-hidden="true">
            <div className="orb-orbit orb-1" />
            <div className="orb-orbit orb-2" />
            <div className="gold-moon">☾</div>
            <div className="hero-paper">
              <span>✦ NUMERIA READING</span>
              <b>
                What lights
                <br />
                your way?
              </b>
              <i>✧　✦　✧</i>
            </div>
          </div>
        </div>
      </section>
      <section className="container section" id="featured">
        <SectionTitle
          eyebrow="FEATURED READINGS"
          title="今のあなたに寄り添う鑑定"
          sub="気になる占術・相談テーマから選べます。販売者・納期・支払時期は各商品でご確認ください。"
        />
        <div className="chip-row">
          <button onClick={() => setKeyword("")} aria-pressed={keyword === ""}>
            すべて
          </button>
          {["タロット", "数秘術", "恋愛", "仕事"].map((word) => (
            <button
              key={word}
              aria-pressed={keyword === word}
              onClick={() => setKeyword(word)}
            >
              {word}
            </button>
          ))}
        </div>
        {shown.length ? (
          <div className="card-grid">
            {shown.map((l) => (
              <ListingCard key={l.id} listing={l} />
            ))}
          </div>
        ) : (
          <div className="empty">
            <h3>見つかりませんでした</h3>
            <p>別のキーワードでお試しください。</p>
            <button className="button" onClick={() => setKeyword("")}>
              すべて表示
            </button>
          </div>
        )}
      </section>
      <section className="statement">
        <div className="container">
          <span className="eyebrow">HOW IT WORKS</span>
          <h2>選ぶ、相談する、受け取る。</h2>
          <div className="steps-overview">
            {[
              ["01", "鑑定を見つける"],
              ["02", "相談内容を伝える"],
              ["03", "条件を確認する"],
              ["04", "鑑定書を受け取る"],
            ].map(([no, txt]) => (
              <div key={no}>
                <b>{no}</b>
                <strong>{txt}</strong>
              </div>
            ))}
          </div>
          <p className="muted">
            実際の注文・決済機能は開発中です。この画面では架空シナリオを確認できます。
          </p>
        </div>
      </section>
    </Layout>
  );
}
function Explore() {
  const [filter, setFilter] = useState("すべて");
  const shown = listings.filter(
    (l) =>
      filter === "すべて" || l.category === filter || l.theme.includes(filter),
  );
  return (
    <Layout>
      <div className="container section">
        <SectionTitle
          eyebrow="EXPLORE"
          title="鑑定書を探す"
          sub={sectionDescription}
        />
        <div className="chip-row">
          {["すべて", "数秘術", "タロット", "恋愛", "仕事"].map((x) => (
            <button
              key={x}
              onClick={() => setFilter(x)}
              aria-pressed={filter === x}
            >
              {x}
            </button>
          ))}
        </div>
        <div className="card-grid">
          {shown.map((l) => (
            <ListingCard key={l.id} listing={l} />
          ))}
        </div>
      </div>
    </Layout>
  );
}
function Item({ slug }: { slug: string }) {
  const l = fixtureGateway.getListingBySlug(slug);
  if (!l) return <NotFound />;
  const seller = sellerFor(l);
  return (
    <Layout>
      <div className="container section">
        <div className="breadcrumbs">
          <Link to="/">ホーム</Link> / <Link to="/explore">鑑定を探す</Link> /
          商品詳細
        </div>
        <div className="product-detail">
          <div className="product-visual">
            <span className="eyebrow">
              {l.category} ／ {l.theme}
            </span>
            <span className="product-symbol">
              {l.category === "タロット" ? "☽" : "7"}
            </span>
            <span>鑑定書サンプルイメージ（架空）</span>
          </div>
          <div className="product-info">
            <span className="eyebrow">PERSONAL READING</span>
            <h1>{l.name}</h1>
            <p className="seller-line">
              販売者：<Link to={"/shops/" + seller?.slug}>{seller?.name}</Link>
              　・{modeName(l.mode)}
            </p>
            <p>
              いまのあなたの状況を読み解き、見返せる鑑定書としてお届けするサービスの架空サンプルです。
            </p>
            <div className="price-panel">
              <span>税込想定価格（架空）</span>
              <strong>{money(l.price)}</strong>
            </div>
            <div className="policy-panel">
          <h2 className="policy-heading">ご依頼前にご確認ください</h2>
              <dl>
                <div>
                  <dt>支払い方式</dt>
                  <dd>{policyLabels[l.policy as keyof typeof policyLabels]}</dd>
                </div>
                <div>
                  <dt>制作目安</dt>
                  <dd>約{l.days}日（デモ）</dd>
                </div>
                <div>
                  <dt>鑑定書</dt>
                  <dd>Web閲覧・条件を満たせばPDF取得</dd>
                </div>
                <div>
                  <dt>キャンセル</dt>
                  <dd>開始前取消など、表示した条件に基づく（デモ）</dd>
                </div>
              </dl>
              <p className="muted">
                {l.policy === "FULL_POSTPAY"
                  ? "完全後払い：公開済みWeb全文を支払前に閲覧できます。PDFは支払確認後です。"
                  : l.policy === "PREVIEW_POSTPAY"
                    ? "一部確認後払い：支払前は公開済みの一部を確認、支払後に全文とPDFを利用できます。"
                    : "先払い：決済が確認された後に鑑定制作へ進みます。"}
              </p>
            </div>
            <ButtonLink to={"/order/new?listing=" + l.id}>
              架空の依頼フローを見る
            </ButtonLink>
            <p className="small muted">※ 実際に注文・決済は行われません。</p>
          </div>
        </div>
      </div>
    </Layout>
  );
}
function Wizard() {
  const navigate = useNavigate();
  const search = new URLSearchParams(useLocation().search);
  const l = listings.find((x) => x.id === search.get("listing")) || listings[0];
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [consult, setConsult] = useState("");
  const [accepted, setAccepted] = useState(false);
  const phases = ["お名前", "相談内容", "支払条件", "最終確認"];
  const seller = sellerFor(l);
  const canNext =
    step === 0
      ? name.trim().length > 0
      : step === 1
        ? consult.trim().length > 0
        : step === 2
          ? accepted
          : true;
  function next() {
    if (step === 3) {
      navigate(
        "/me/orders/" +
          (l.policy === "PREPAY"
            ? "ord-pre-wait"
            : l.policy === "PREVIEW_POSTPAY"
              ? "ord-preview"
              : "ord-full-unpaid"),
      );
      return;
    }
    if (canNext) setStep((i) => i + 1);
  }
  return (
    <Layout>
      <div className="container section narrow">
        <div className="eyebrow">DEMO ORDER FLOW</div>
        <h1>鑑定を依頼する流れ</h1>
        <p className="muted">
          このフォームは架空シナリオです。入力内容はサーバーへ送信されません。リロードすると失われます。個人情報は入力しないでください。
        </p>
        <div className="stepper" aria-label="依頼の進行状況">
          {phases.map((s, i) => (
            <span key={s} className={step === i ? "active" : ""}>
              {i + 1}. {s}
            </span>
          ))}
        </div>
        <div className="wizard-panel">
          <h2>{phases[step]}</h2>
          {step === 0 ? (
            <>
              <label htmlFor="demo-name">
                表示用のお名前（架空の文字列のみ）
              </label>
              <input
                id="demo-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例：デモさん"
                maxLength={40}
              />
              <p className="hint">
                実際の本人確認、誕生日・出生地入力には対応していません。
              </p>
            </>
          ) : step === 1 ? (
            <>
              <label htmlFor="demo-consult">相談テーマ（架空の文章のみ）</label>
              <textarea
                id="demo-consult"
                rows={4}
                placeholder="例：仕事の方向性を整理したい"
                value={consult}
                onChange={(e) => setConsult(e.target.value)}
                maxLength={240}
              />
              <p className="hint">実際の相談内容は入力しないでください。</p>
            </>
          ) : step === 2 ? (
            <>
              <p>
                販売者：{seller?.name}　商品：{l.name}
              </p>
              <div className="summary-row">
                架空価格 <strong>{money(l.price)}</strong>
              </div>
              <p>
                支払い：{policyLabels[l.policy as keyof typeof policyLabels]}
                　制作目安：{l.days}日
              </p>
              <p>
                相談内容は本来、購入者の同意範囲で販売者に共有されます。ここでは外部共有しません。
              </p>
              <label className="checkline">
                <input
                  type="checkbox"
                  checked={accepted}
                  onChange={(e) => setAccepted(e.target.checked)}
                />{" "}
                この架空の販売条件と共有先を確認しました
              </label>
            </>
          ) : (
            <>
              <p>販売者：{seller?.name}</p>
              <p>商品：{l.name}</p>
              <p>
                支払い：{policyLabels[l.policy as keyof typeof policyLabels]}　
                {money(l.price)}（架空）
              </p>
              <div className="notice">
                <b>ここから先は既存の架空注文サンプル画面です。</b>
                <p>注文や支払いは作成されず、入力内容は破棄されます。</p>
              </div>
            </>
          )}
          <div className="form-actions">
            <button
              type="button"
              className="button-ghost"
              disabled={step === 0}
              onClick={() => setStep((i) => Math.max(0, i - 1))}
            >
              戻る
            </button>
            <button
              type="button"
              className="button"
              disabled={!canNext}
              onClick={next}
            >
              {step === 3 ? "架空の注文画面を見る" : "次へ →"}
            </button>
          </div>
        </div>
      </div>
    </Layout>
  );
}
function OrderDetails({ id }: { id: string }) {
  const original = fixtureGateway.getOrder(id);
  const [override, setOverride] = useState<"UNCHANGED" | "PAID">("UNCHANGED");
  if (!original || original.buyer !== fixtureAuth.currentBuyerId)
    return <NotFound />;
  const order =
    override === "PAID" ? { ...original, payment: "PAID" } : original;
  const listing = listingFor(order);
  const access = entitlement(order);
  return (
    <Layout>
      <div className="container section narrow">
        <h1 className="sr-only">注文と鑑定書の詳細</h1>
        <div className="breadcrumbs">
          <Link to="/me/orders">鑑定書一覧</Link> / デモ注文詳細
        </div>
        <SectionTitle
          eyebrow="MY READING"
          title="鑑定の進み具合"
          sub="すべての注文・鑑定書本文・決済状態は架空です。実認証による閲覧制御はありません。"
        />
        <div className="detail-card">
          <span className="eyebrow">{order.id}</span>
          <h2>{listing?.name}</h2>
          <p>
            販売者：{listing ? sellerFor(listing)?.name : "―"}　｜　
            {policyLabels[order.policy as keyof typeof policyLabels]}
          </p>
          <div className="triad">
            <div>
              <small>鑑定</small>
              <strong>{stepLabel(order.fulfillment)}</strong>
            </div>
            <div>
              <small>支払い</small>
              <strong>{paymentLabel(order.payment)}</strong>
            </div>
            <div>
              <small>Web公開</small>
              <strong>{publishedLabel(order.publication)}</strong>
            </div>
          </div>
          <div className="reading-preview">
            <div className="reading-header">
              <span className="eyebrow">REPORT / DEMO</span>
              <h3>
                {access.web === "FULL"
                  ? "架空の鑑定書（全文表示例）"
                  : access.web === "PREVIEW"
                    ? "鑑定書プレビュー（架空）"
                    : "現在は閲覧できません"}
              </h3>
            </div>
            {access.web === "FULL" ? (
              <p>
                星の動きやカードの象徴を通じて、自分自身の歩みを考えるための架空の文書です。これは実在の相談にも鑑定にも基づいていません。
              </p>
            ) : access.web === "PREVIEW" ? (
              <p>
                公開された架空プレビューです。全文は支払確認後に閲覧できます。
              </p>
            ) : (
              <p>まだ本人向けに公開されていない状態の表示例です。</p>
            )}
          </div>
          <div className="permission-row">
            <span>
              Web閲覧:{" "}
              <b>
                {access.web === "FULL"
                  ? "全文"
                  : access.web === "PREVIEW"
                    ? "一部のみ"
                    : "不可"}
              </b>
            </span>
            <span>
              PDF: <b>{access.pdf ? "取得可能な状態例" : "取得不可"}</b>
            </span>
          </div>
          <div className="notice">
            <b>PDFの実ファイルは配信しません。</b>
            <p>
              本番では支払いをStripe側で検証し、本人・注文・文書の権限をサーバーで確認します。
            </p>
          </div>
          {order.policy !== "PREPAY" && original.payment !== "PAID" ? (
            <button
              className="button-ghost"
              type="button"
              onClick={() =>
                setOverride((o) => (o === "PAID" ? "UNCHANGED" : "PAID"))
              }
            >
              {override === "PAID"
                ? "未払いの架空表示に戻す"
                : "支払済みの架空表示例に切り替える"}
            </button>
          ) : null}
          <div className="form-actions">
            <ButtonLink to="/me/orders">鑑定書一覧へ</ButtonLink>
            <ButtonLink to={"/items/" + listing?.slug} light>
              商品を確認
            </ButtonLink>
          </div>
        </div>
      </div>
    </Layout>
  );
}
function OrdersList() {
  return (
    <Layout>
      <div className="container section">
        <SectionTitle
          eyebrow="MY READINGS"
          title="鑑定書と注文"
          sub={sectionDescription}
        />
        <div className="order-list">
          {fixtureGateway
            .listOrdersForBuyer(fixtureAuth.currentBuyerId)
            .map((o) => (
              <Link
                key={o.id}
                to={"/me/orders/" + o.id}
                className="order-list-row"
              >
                <span className="order-icon">✧</span>
                <span>
                  <strong>{listingFor(o)?.name}</strong>
                  <small>
                    {stepLabel(o.fulfillment)}　・　{paymentLabel(o.payment)}
                    　・　{publishedLabel(o.publication)}
                  </small>
                </span>
                <b aria-hidden="true">→</b>
              </Link>
            ))}
        </div>
      </div>
    </Layout>
  );
}
function Seller() {
  const [selected, setSelected] = useState(sellers[0].id);
  const s = sellers.find((x) => x.id === selected) || sellers[0];
  const sellerListings = listings.filter((l) => l.sellerId === s.id);
  const sellerOrders = orders.filter((o) =>
    sellerListings.some((l) => l.id === o.listingId),
  );
  return (
    <Layout seller>
      <section className="seller-hero">
        <div className="container">
          <span className="eyebrow">SELLER STUDIO / DEMO</span>
          <h1>出店者ホーム</h1>
          <p>
            お客様への対応、鑑定書、売上状況をひとつに。すべて架空の業務デモです。
          </p>
          <label className="seller-switch" htmlFor="demo-seller">
            表示する架空ショップ　
            <select
              id="demo-seller"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              {sellers.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>
      <div className="container section">
        <div className="seller-summary">
          <div>
            <small>架空の商品</small>
            <strong>{sellerListings.length}</strong>
          </div>
          <div>
            <small>架空の注文</small>
            <strong>{sellerOrders.length}</strong>
          </div>
          <div>
            <small>Stripeの表示例</small>
            <strong>
              {s.connect === "ENABLED" ? "準備済み（架空）" : "要確認"}
            </strong>
          </div>
          <div>
            <small>Business連携</small>
            <strong>{s.business ? "連携表示例" : "不要・単独利用"}</strong>
          </div>
        </div>
        <div className="seller-columns">
          <section className="panel">
            <h2>優先して対応すること</h2>
            <p className="muted">
              このボードは作業を開始しません。注文詳細の架空状態を確認できます。
            </p>
            <div className="order-list">
              {sellerOrders.slice(0, 4).map((o) => (
                <Link
                  key={o.id}
                  className="order-list-row"
                  to={"/me/orders/" + o.id}
                >
                  <span className="order-icon">✦</span>
                  <span>
                    <strong>{listingFor(o)?.name}</strong>
                    <small>
                      {stepLabel(o.fulfillment)} ／ {paymentLabel(o.payment)}
                    </small>
                  </span>
                  →
                </Link>
              ))}
            </div>
            <Link className="text-link" to="/seller/orders">
              注文をすべて見る →
            </Link>
          </section>
          <section className="panel">
            <h2>ショップ運営</h2>
            <p>一般出店はNumeria Studio Businessなしでも利用できます。</p>
            <div className="seller-links">
              <Link to={"/shops/" + s.slug}>ショップを見る →</Link>
              <Link to="/seller/items">商品を管理する →</Link>
              <Link to="/seller/finance">売上を確認する →</Link>
              {s.business ? (
                <Link to="/seller/lp">Business専用LPを確認 →</Link>
              ) : (
                <p className="muted">
                  Business専用LPは未契約です（通常ショップは利用可能）。
                </p>
              )}
            </div>
          </section>
        </div>
      </div>
    </Layout>
  );
}
function LP({ slug }: { slug: string }) {
  const s = sellers.find((x) => x.slug === slug);
  if (!s) return <NotFound />;
  const ls = listings.filter((l) => l.sellerId === s.id);
  return (
    <Layout>
      <div className="lp-hero">
        <div className="container lp-hero-inner">
          <div>
            <span className="eyebrow">PRIVATE READING ATELIER</span>
            <p className="lp-stamp">
              ✧　
              {s.mode === "NS_BUSINESS_LINKED"
                ? "BUSINESS LP DEMO"
                : "SHOP DEMO"}
              　✧
            </p>
            <h1>{s.headline}</h1>
            <p>{s.about}</p>
            <a className="button button-light" href="#lp-list">
              鑑定メニューを見る ↓
            </a>
          </div>
          <div className="lp-seal" aria-hidden="true">
            ☽<span>✧</span>
          </div>
        </div>
      </div>
      <div className="container section" id="lp-list">
        <SectionTitle
          eyebrow="PERSONAL READINGS"
          title="ご案内している鑑定"
          sub="販売条件はNumeria Placeの商品情報をそのまま表示しています。架空のデモ価格です。"
        />
        <div className="card-grid">
          {ls.map((l) => (
            <ListingCard key={l.id} listing={l} />
          ))}
        </div>
        <div className="notice">
          <strong>ご依頼は共通の商品詳細から</strong>
          <p>
            LPごとの別注文・別決済はありません。支払い方式、キャンセル条件、PDF取得条件は商品画面で確認してください。
          </p>
        </div>
      </div>
    </Layout>
  );
}
function Shop({ slug }: { slug: string }) {
  const s = sellers.find((x) => x.slug === slug);
  if (!s) return <NotFound />;
  return (
    <Layout>
      <div className="container section">
        <div className="breadcrumbs">
          <Link to="/explore">鑑定を探す</Link> / ショップ
        </div>
        <SectionTitle eyebrow="SELLER SHOP" title={s.name} sub={s.about} />
        <div className="card-grid">
          {listings
            .filter((l) => l.sellerId === s.id)
            .map((l) => (
              <ListingCard key={l.id} listing={l} />
            ))}
        </div>
        <p>
          <Link className="text-link" to={"/lp/" + s.slug}>
            LP表示例を見る →
          </Link>
        </p>
      </div>
    </Layout>
  );
}
function Secondary({ path }: { path: string }) {
  const seller = path.startsWith("/seller");
  const map: Record<string, [string, string]> = {
    "/me/library": [
      "鑑定書ライブラリ",
      "架空の注文一覧から内容を確認できます。",
    ],
    "/me/profile": [
      "マイページ",
      "本人確認・プロフィール保存はこのフェーズでは実装しません。",
    ],
    "/me/settings": ["設定", "本番の本人情報・通知設定はまだ使えません。"],
    "/seller/orders": [
      "注文管理",
      "販売者の架空注文・鑑定・入金状態を一覧で確認する導線です。",
    ],
    "/seller/items": [
      "商品管理",
      "既存の架空商品を確認できます。実商品の登録・編集はできません。",
    ],
    "/seller/shop": [
      "ショップ管理",
      "一般出店者のショップとBusiness専用LPを分離します。",
    ],
    "/seller/finance": [
      "売上・入金",
      "架空の売上／未収／返金／入金は別々の状態として扱います。",
    ],
    "/seller/integrations": [
      "連携設定",
      "Clerk・Stripe Connect・NS Businessの実接続は行いません。",
    ],
    "/seller/lp": [
      "LP編集デモ",
      "下書きと公開版を分ける予定です。実公開は行いません。",
    ],
    "/sell": [
      "出店について",
      "Numeria Studio Businessは出店の必須条件ではありません。",
    ],
  };
  const [title, desc] = map[path] || [
    "未実装の画面",
    "この画面は開発準備中です。",
  ];
  return (
    <Layout seller={seller}>
      <div className="container section narrow">
        <span className="eyebrow">FIXTURE VIEW</span>
        <h1>{title}</h1>
        <p>{desc}</p>
        <div className="notice">{sectionDescription}</div>
        <div className="panel">
          <h2>次の操作</h2>
          {seller ? (
            <div className="seller-links">
              <Link to="/seller">出店者ホームへ →</Link>
              <Link to="/shops/star-notes-demo">通常ショップを見る →</Link>
              <Link to="/lp/moonlight-demo">Business専用LPを見る →</Link>
            </div>
          ) : (
            <div className="seller-links">
              <Link to="/me/orders">架空の注文一覧へ →</Link>
              <Link to="/explore">鑑定を探す →</Link>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
function NotFound() {
  return (
    <Layout>
      <div className="container section narrow">
        <span className="eyebrow">404</span>
        <h1>ページが見つかりません</h1>
        <p>架空データには存在しないURLです。</p>
        <ButtonLink to="/">トップへ戻る</ButtonLink>
      </div>
    </Layout>
  );
}
export default function Market() {
  const { pathname } = useLocation();
  const path = decodeURIComponent(pathname);
  if (path === "/") return <Home />;
  if (path === "/explore") return <Explore />;
  if (path.startsWith("/items/")) return <Item slug={path.slice(7)} />;
  if (path === "/order/new") return <Wizard />;
  if (path === "/me/orders") return <OrdersList />;
  if (path.startsWith("/me/orders/"))
    return <OrderDetails id={path.slice(11)} />;
  if (path === "/seller") return <Seller />;
  if (path.startsWith("/lp/")) return <LP slug={path.slice(4)} />;
  if (path.startsWith("/shops/")) return <Shop slug={path.slice(7)} />;
  if (
    [
      "/me/library",
      "/me/profile",
      "/me/settings",
      "/seller/orders",
      "/seller/items",
      "/seller/shop",
      "/seller/finance",
      "/seller/integrations",
      "/seller/lp",
      "/sell",
    ].includes(path)
  )
    return <Secondary path={path} />;
  return <NotFound />;
}
