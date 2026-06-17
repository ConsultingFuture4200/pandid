import { expect, test } from "@playwright/test";

test("home page renders the app title", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /Extraction P&ID Co-Editor/i }),
  ).toBeVisible();
});
