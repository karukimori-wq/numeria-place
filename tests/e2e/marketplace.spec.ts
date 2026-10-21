import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const paths = [
  ["/", "あなたの物語に"],
  ["/items/first-step-demo", "数秘術・はじめの鑑定"],
  ["/me/orders/ord-full-unpaid", "鑑定の進み具合"],
  ["/seller", "出店者ホーム"],
  ["/lp/moonlight-demo", "こころに、静かな光を。"],
] as const;
test("five primary routes render and use fixture-only banner", async ({
  page,
}) => {
  for (const [route, title] of paths) {
    await page.goto(route);
    await expect(page.getByText("DEMO / 架空")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: title, exact: false }).first(),
    ).toBeVisible();
  }
});
test("primary routes have no automatically detectable accessibility violations", async ({
  page,
}) => {
  for (const [route] of paths) {
    await page.goto(route);
    const results = await new AxeBuilder({ page })
      .disableRules(["color-contrast"])
      .analyze();
    expect(results.violations, route).toEqual([]);
  }
});
test("keyboard users can skip repeated navigation", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "本文へ移動" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toBeFocused();
});
test("listing and business LP route to the same shared listing", async ({
  page,
}) => {
  await page.goto("/lp/moonlight-demo");
  await page
    .getByRole("link", { name: "詳細を見る", exact: false })
    .first()
    .click();
  await expect(page).toHaveURL(/\/items\/tarot-preview-demo/);
  await expect(page.getByText("月灯のアトリエ").first()).toBeVisible();
});
test("full postpay unpaid shows web text but cannot download PDF", async ({
  page,
}) => {
  await page.goto("/me/orders/ord-full-unpaid");
  await expect(
    page.getByRole("heading", { name: /架空の鑑定書/ }),
  ).toBeVisible();
  await expect(page.getByText("PDF:")).toContainText("取得不可");
  await expect(
    page.getByRole("button", { name: /支払済みの架空表示例/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: /支払済みの架空表示例/ }).click();
  await expect(page.getByText("PDF:")).toContainText("取得可能な状態例");
});
test("preview postpay only shows preview and blocks PDF", async ({ page }) => {
  await page.goto("/me/orders/ord-preview");
  await expect(
    page.getByRole("heading", { name: /鑑定書プレビュー/ }),
  ).toBeVisible();
  await expect(page.getByText("PDF:")).toContainText("取得不可");
});
test("order wizard requires consent and never submits real order", async ({
  page,
}) => {
  await page.goto("/order/new?listing=lst-number");
  await page.getByLabel("表示用のお名前").fill("架空さん");
  await page.getByRole("button", { name: "次へ" }).click();
  await page.getByLabel("相談テーマ").fill("デモの相談です");
  await page.getByRole("button", { name: "次へ" }).click();
  await expect(page.getByRole("button", { name: "次へ" })).toBeDisabled();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "次へ" }).click();
  await page.getByRole("button", { name: "架空の注文画面を見る" }).click();
  await expect(page).toHaveURL(/ord-pre-wait/);
});
test("responsive screenshots 5 screens x 5 widths", async ({ page }) => {
  const shots = [
    ["home", "/"],
    ["item", "/items/first-step-demo"],
    ["order", "/me/orders/ord-full-unpaid"],
    ["seller", "/seller"],
    ["lp", "/lp/moonlight-demo"],
  ];
  for (const w of [375, 390, 430, 768, 1440]) {
    await page.setViewportSize({ width: w, height: 900 });
    for (const [name, path] of shots) {
      await page.goto(path);
      await expect(page.locator("main")).toBeVisible();
      const over = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1,
      );
      expect(over, "horizontal overflow " + path + " " + w).toBe(false);
      await page.screenshot({
        path: "test-results/screenshots/" + name + "-" + w + ".png",
        fullPage: true,
      });
    }
  }
});
