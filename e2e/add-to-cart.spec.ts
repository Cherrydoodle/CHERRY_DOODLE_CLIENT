import { expect, test } from "@playwright/test";

test("add to cart opens the drawer, syncs to /cart, and gates checkout behind login", async ({ page }) => {
  await page.goto("/");

  const productCard = page.locator(".card-soft").first();
  // Index 0 is the image link (aria-label "View {name}", no visible text);
  // index 1 is the product name link with real visible text.
  const productName = await productCard.getByRole("link").nth(1).innerText();

  await productCard.getByRole("button", { name: "Add to Cart" }).click();

  const drawer = page.getByRole("dialog");
  await expect(drawer.getByRole("heading", { name: "Added to bag ✓" })).toBeVisible();
  // .last() — the drawer row's image link shares the same accessible name (its
  // alt text) as the product-name text link that follows it.
  await expect(drawer.getByRole("link", { name: productName, exact: false }).last()).toBeVisible();

  await drawer.getByRole("link", { name: "View bag" }).click();
  await expect(page).toHaveURL(/\/cart$/);
  await expect(page.getByRole("heading", { name: "Your bag" })).toBeVisible();
  await expect(page.getByText(productName, { exact: false }).first()).toBeVisible();

  // Checkout requires an authenticated account (RZ-045 / RZ-000 decision #26) —
  // an unauthenticated shopper must be redirected to login, not straight through.
  await page.getByRole("link", { name: "Secure Checkout" }).click();
  await expect(page).toHaveURL(/\/auth\/login\?next=%2Fcheckout/);
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
});

test("product page add-to-bag opens the drawer with the selected quantity", async ({ page }) => {
  await page.goto("/");
  await page.locator(".card-soft").first().getByRole("link").nth(1).click();
  await expect(page).toHaveURL(/\/product\//);

  await page.getByRole("button", { name: "Increase quantity" }).click();
  // Related-product cards further down render "Add to Cart" now, so this
  // name is unambiguous — only the main page's own button matches.
  await page.getByRole("button", { name: "Add to bag" }).click();

  const drawer = page.getByRole("dialog");
  await expect(drawer.getByRole("heading", { name: "Added to bag ✓" })).toBeVisible();
  await expect(drawer.getByText("2", { exact: true })).toBeVisible();
});
