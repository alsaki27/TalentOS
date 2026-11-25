import { expect, test } from "@playwright/test";

for (const touch of [false, true]) {
  test.describe(touch ? "Team menu on touch" : "Team menu on desktop", () => {
    test.use({ hasTouch: touch, viewport: { width: touch ? 390 : 1200, height: 800 } });

    test("a double activation only opens the member's menu", async ({ page }) => {
      const admin = { user_id: "test-admin", display_name: "Test Admin", role: "admin", is_active: true };
      const member = { user_id: "test-member", display_name: "Test Member", role: "application_engineer", is_active: true };
      const writes: string[] = [];
      await page.route("**/api/bootstrap", route => route.fulfill({ json: { profile: admin } }));
      await page.route(/\/api\/users(?:[/?]|$)/, route => {
        if (route.request().method() === "GET") return route.fulfill({ json: [admin, member] });
        writes.push(route.request().method());
        return route.fulfill({ status: 403, json: {} });
      });
      await page.goto("/team");
      if (new URL(page.url()).pathname === "/login") {
        const email = process.env.TEST_ADMIN_EMAIL;
        const password = process.env.TEST_ADMIN_PASSWORD;
        test.skip(!email || !password, "The Team page requires an admin session.");
        const response = await page.request.post("/api/auth/login", { data: { email, password } });
        expect(response.ok()).toBe(true);
        await page.goto("/team");
      }

      const trigger = page.getByRole("button", { name: "Open actions for Test Member" });
      await trigger.scrollIntoViewIfNeeded();
      const box = await trigger.boundingBox();
      if (!box) throw new Error("Member actions button has no visible bounds");
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      if (touch) await page.touchscreen.tap(x, y);
      else await page.mouse.click(x, y);
      const menu = page.getByRole("menu");
      await expect(menu).toBeVisible();
      // Use the original screen position even if the page shifts as the menu opens.
      await page.waitForTimeout(100);
      if (touch) await page.touchscreen.tap(x, y);
      else {
        await page.mouse.down({ clickCount: 2 });
        await page.mouse.up({ clickCount: 2 });
      }
      await expect(menu).toBeVisible();
      await expect(trigger).toHaveAttribute("aria-expanded", "true");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(menu).toHaveCount(0);
      expect(writes).toEqual([]);
    });
  });
}
