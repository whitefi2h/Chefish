import type { Page } from "@playwright/test";

export async function answerAppDialog(page: Page, accept: boolean) {
  const dialog = page.locator(".app-confirm-dialog[open]");
  await dialog.waitFor();
  await dialog
    .locator(accept ? 'button[type="submit"]' : 'button[type="button"]')
    .filter({ hasText: accept ? /./ : "取消" })
    .click();
  await dialog.waitFor({ state: "hidden" });
}
