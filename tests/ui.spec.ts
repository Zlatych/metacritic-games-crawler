import Database from "better-sqlite3";
import { expect, test } from "@playwright/test";

// The web server (see playwright.config.ts) runs migrations on tmp/e2e.db; we seed it directly.
test.beforeAll(() => {
  const db = new Database("./tmp/e2e.db");
  db.exec("DELETE FROM similar_games; DELETE FROM game_platforms; DELETE FROM letsplays; DELETE FROM games;");
  const game = db.prepare(
    `INSERT INTO games (id, slug, title, description, developer, genres, release_date, metascore, userscore, critic_summary)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const summary = JSON.stringify({ summary: "Критики в восторге.", likes: ["Боевая система"], dislikes: ["Камера"], source: "llm", reviewCount: 5, updatedAt: "2026-10-15" });
  game.run(1, "alpha-quest", "Alpha Quest", "Open world fantasy RPG with dragons", "Studio A", '["Action RPG"]', "2026-10-10", 91, 8.4, summary);
  game.run(2, "beta-racer", "Beta Racer", "Arcade racing on neon tracks", "Studio B", '["Racing"]', "2026-10-12", 64, 5.1, null);
  game.run(3, "gamma-saga", "Gamma Saga", "Fantasy RPG with dragons and magic", "Studio A", '["Action RPG"]', "2026-10-01", 78, null, null);
  const platform = db.prepare("INSERT INTO game_platforms (game_id, name, slug, position, is_lead, metascore, critic_count) VALUES (?, ?, ?, 0, 1, ?, 10)");
  platform.run(1, "PlayStation 5", "playstation-5", 91);
  platform.run(2, "PC", "pc", 64);
  platform.run(3, "PC", "pc", 78);
  db.prepare("INSERT INTO similar_games (game_id, similar_id, score) VALUES (1, 3, 0.7)").run();
  db.close();
});

test("list: search, platform filter and rating sort", async ({ page }) => {
  await page.goto("/");
  const titles = page.locator(".tile__title");
  await expect(titles).toHaveText(["Alpha Quest", "Gamma Saga", "Beta Racer"]); // metascore desc

  await page.getByLabel("Поиск").fill("beta");
  await expect(titles).toHaveText(["Beta Racer"]);

  await page.getByLabel("Поиск").fill("");
  await page.getByLabel("Платформа").selectOption("PC");
  await expect(titles).toHaveText(["Gamma Saga", "Beta Racer"]);
  await expect(page).toHaveURL(/platform=PC/);
});

test("game card: details, summaries and similar games navigation", async ({ page }) => {
  await page.goto("/game/alpha-quest");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Alpha Quest");
  await expect(page.getByText("Studio A")).toBeVisible();
  await expect(page.getByText("Критики в восторге.")).toBeVisible();
  await page.locator(".similar").getByText("Gamma Saga").click();
  await expect(page).toHaveURL(/\/game\/gamma-saga$/);
});

test("monitor: live connection and worker pools", async ({ page }) => {
  await page.goto("/monitor");
  await expect(page.locator("#conn")).toHaveText("online");
  await expect(page.getByRole("heading", { name: "Сбор данных Metacritic" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Запустить обработку" })).toBeEnabled();
});
