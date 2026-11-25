import { expect, test } from "@playwright/test";

for (const touch of [false, true]) {
  test.describe(touch ? "Team menu on touch" : "Team menu on desktop", () => {
    test.use({ hasTouch: touch, viewport: { width: touch ? 390 : 1200, height: 800 } });

    test("a double activation opens the roles and only confirmation saves a new role", async ({ page }) => {
      const admin = { user_id: "test-admin", display_name: "Test Admin", role: "admin", is_active: true };
      const member = { user_id: "test-member", display_name: "Test Member", role: "application_engineer", is_active: true };
      const writes: { method: string; path: string; body: unknown }[] = [];
      await page.route("**/api/bootstrap", route => route.fulfill({ json: { profile: admin } }));
      await page.route(/\/api\/users(?:[/?]|$)/, route => {
        if (route.request().method() === "GET") return route.fulfill({ json: [admin, member] });
        const req = route.request();
        writes.push({ method: req.method(), path: new URL(req.url()).pathname, body: req.postDataJSON() });
        if (writes.length === 1) return route.fulfill({ status: 503, json: { error: "Please retry the role update." } });
        return route.fulfill({ json: { ...member, role_key: "application_engineer_reviewer", role_label: "Application Engineer (Reviewer)" } });
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

      await page.getByRole("button", { name: "Create User", exact: true }).click();
      const rolePicker = page.getByLabel("Role *", { exact: true });
      await expect(rolePicker).toHaveValue("");
      await expect(rolePicker.getByRole("option", { name: "Application Engineer", exact: true })).toHaveCount(0);
      await expect(rolePicker.getByRole("option", { name: "Application Engineer (Grunter)", exact: true })).toHaveCount(1);
      await page.getByRole("button", { name: "Cancel", exact: true }).click();

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
      const reviewer = menu.getByRole("menuitem", { name: "Application Engineer (Reviewer)", exact: true });
      await expect(reviewer).toBeVisible();
      await expect(menu.getByRole("menuitem", { name: "Application Engineer", exact: true })).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(menu).toHaveCount(0);
      expect(writes).toEqual([]);
      const card = page.locator("article").filter({ has: trigger });
      const original = card.getByText("Application Engineer", { exact: true });
      await expect(original).toBeVisible();
      await trigger.press("Enter");
      await reviewer.press("Enter");
      const dialog = page.getByRole("dialog", { name: "Confirm role change" });
      await expect(dialog).toHaveAccessibleDescription("Change Test Member from Application Engineer to Application Engineer (Reviewer)?");
      await expect(dialog.getByRole("combobox")).toHaveCount(0);
      expect(writes).toEqual([]);
      await dialog.getByRole("button", { name: "Cancel" }).press("Enter");
      await expect(dialog).toHaveCount(0);
      await expect(original).toBeVisible();
      await expect(trigger).toBeFocused();
      expect(writes).toEqual([]);
      if (touch) {
        await trigger.tap();
        await reviewer.tap();
      } else {
        await trigger.click();
        await reviewer.click();
      }
      const confirm = dialog.getByRole("button", { name: "Confirm change", exact: true });
      await expect(confirm).toBeVisible();
      expect(writes).toEqual([]);
      await confirm.press("Enter");
      await expect(dialog.getByRole("alert")).toHaveText("Please retry the role update.");
      expect(writes).toHaveLength(1);
      if (touch) await confirm.tap();
      else await confirm.click();
      await expect(dialog).toHaveCount(0);
      await expect(card.getByText("Application Engineer (Reviewer)", { exact: true })).toBeVisible();
      await expect(menu).toHaveCount(0);
      const patch = { method: "PATCH", path: "/api/users/test-member", body: { role: "application_engineer_reviewer" } };
      await trigger.press("Enter");
      await reviewer.press("Enter");
      await expect(menu).toHaveCount(0);
      await expect(dialog).toHaveCount(0);
      expect(writes).toEqual([patch, patch]);
    });
  });
}
