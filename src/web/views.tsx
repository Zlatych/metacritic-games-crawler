import type { Child, FC } from "hono/jsx";
import type { ReviewSummary } from "../db/schema";
import { type GameFull, type ListedGameRow, type ListParams, PAGE_SIZE, SORTS } from "./queries";

const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" }) : "—");
const fmtNum = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("ru-RU"));

function tone(value: number | null, max: number) {
  if (value == null) return "none";
  const v = (value / max) * 100;
  return v >= 75 ? "good" : v >= 50 ? "mixed" : "bad";
}

export const Score: FC<{ value: number | null; kind: "meta" | "user"; size?: "sm" | "lg" }> = ({ value, kind, size = "sm" }) => (
  <span
    class={`score score--${kind} score--${tone(value, kind === "meta" ? 100 : 10)} score--${size}`}
    title={kind === "meta" ? "Metascore" : "User score"}
  >
    {value == null ? "tbd" : kind === "user" ? value.toFixed(1) : value}
  </span>
);

export const Layout: FC<{ title: string; active?: "games" | "monitor"; children?: Child }> = ({ title, active, children }) => (
  <html lang="ru">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{title}</title>
      <link rel="stylesheet" href="/static/style.css" />
      <script src="https://unpkg.com/htmx.org@2.0.4/dist/htmx.min.js" defer></script>
    </head>
    <body>
      <header class="topbar">
        <a href="/" class="brand">
          <span class="brand__mark">MC</span> Games Digest
        </a>
        <nav>
          <a href="/" class={active === "games" ? "active" : ""}>Игры</a>
          <a href="/monitor" class={active === "monitor" ? "active" : ""}>Мониторинг</a>
          <a href="/api/games">API</a>
        </nav>
      </header>
      <main>{children}</main>
    </body>
  </html>
);

const GameTile: FC<{ game: ListedGameRow }> = ({ game }) => (
  <a class="tile" href={`/game/${game.slug}`}>
    <div class="tile__cover">
      {game.coverUrl ? <img src={game.coverUrl} alt="" loading="lazy" /> : <div class="tile__placeholder">{game.title[0]}</div>}
    </div>
    <div class="tile__body">
      <h3 class="tile__title">{game.title}</h3>
      <div class="tile__meta">
        {fmtDate(game.releaseDate)}
        {game.developer && <> · {game.developer}</>}
      </div>
      <div class="chips">
        {game.platforms.slice(0, 4).map((p) => (
          <span class="chip">{p.name}</span>
        ))}
        {game.platforms.length > 4 && <span class="chip">+{game.platforms.length - 4}</span>}
      </div>
      <div class="tile__scores">
        <Score value={game.metascore} kind="meta" />
        <Score value={game.userscore} kind="user" />
        {game.genres[0] && <span class="tile__genre">{game.genres[0]}</span>}
      </div>
    </div>
  </a>
);

export const GameList: FC<{ items: ListedGameRow[]; total: number; params: ListParams }> = ({ items, total, params }) => {
  const page = params.page ?? 1;
  const next = new URLSearchParams({
    ...(params.q ? { q: params.q } : {}),
    ...(params.platform ? { platform: params.platform } : {}),
    sort: params.sort ?? "metascore",
    page: String(page + 1),
  });
  return (
    <>
      {items.map((g) => (
        <GameTile game={g} />
      ))}
      {page * PAGE_SIZE < total && (
        <div class="more" hx-get={`/?${next}`} hx-select="#games > *" hx-target="this" hx-swap="outerHTML" hx-trigger="revealed">
          Загрузка…
        </div>
      )}
    </>
  );
};

export const IndexPage: FC<{ items: ListedGameRow[]; total: number; params: ListParams; platforms: string[] }> = ({
  items,
  total,
  params,
  platforms,
}) => (
  <Layout title="Игры — Metacritic Digest" active="games">
    <form class="filters" hx-get="/" hx-target="#results" hx-select="#results" hx-swap="outerHTML" hx-push-url="true" hx-trigger="input changed delay:300ms from:input, change from:select">
      <input type="search" name="q" value={params.q ?? ""} placeholder="Поиск по названию…" aria-label="Поиск" autocomplete="off" />
      <select name="platform" aria-label="Платформа">
        <option value="">Все платформы</option>
        {platforms.map((p) => (
          <option value={p} selected={p === params.platform}>
            {p}
          </option>
        ))}
      </select>
      <select name="sort" aria-label="Сортировка">
        {Object.entries(SORTS).map(([k, label]) => (
          <option value={k} selected={k === (params.sort ?? "metascore")}>
            {label}
          </option>
        ))}
      </select>
    </form>
    <section id="results">
      <p class="muted">Найдено игр: {total}</p>
      {total === 0 ? (
        <div class="empty">
          Пока пусто. Первый обход запускается автоматически — следите за ним на странице <a href="/monitor">Мониторинг</a>.
        </div>
      ) : (
        <div id="games" class="grid">
          <GameList items={items} total={total} params={params} />
        </div>
      )}
    </section>
  </Layout>
);

const SummaryBlock: FC<{ title: string; data: ReviewSummary | null; count: number }> = ({ title, data, count }) => (
  <section class="panel">
    <h2>
      {title} <span class="muted">· {fmtNum(count)} отзывов</span>
    </h2>
    {!data ? (
      <p class="muted">Резюме ещё не готово.</p>
    ) : (
      <>
        <p>{data.summary}</p>
        <div class="proscons">
          <div>
            <h3 class="pros-title">Нравится</h3>
            {data.likes.length ? <ul>{data.likes.map((l) => <li>{l}</li>)}</ul> : <p class="muted">—</p>}
          </div>
          <div>
            <h3 class="cons-title">Не нравится</h3>
            {data.dislikes.length ? <ul>{data.dislikes.map((l) => <li>{l}</li>)}</ul> : <p class="muted">—</p>}
          </div>
        </div>
        <p class="source">
          {data.source === "llm" ? "Сгенерировано LLM" : "Экстрактивное резюме (LLM недоступен)"} по {data.reviewCount} отзывам ·{" "}
          {fmtDate(data.updatedAt)}
        </p>
      </>
    )}
  </section>
);

const LetsPlayBlock: FC<{ lp: GameFull["letsplay"] }> = ({ lp }) => {
  const status: Record<string, string> = {
    not_found: "Подходящий летсплей на YouTube не найден.",
    no_transcript: "Летсплей найден, но получить расшифровку речи не удалось.",
    error: "Ошибка при обработке летсплея — повторим при следующем обходе.",
  };
  return (
    <section class="panel">
      <h2>Летсплей на YouTube</h2>
      {!lp ? (
        <p class="muted">Ещё не обработан.</p>
      ) : (
        <>
          {lp.videoId && (
            <>
              <div class="video">
                <iframe src={`https://www.youtube-nocookie.com/embed/${lp.videoId}`} title={lp.title ?? "Let's play"} loading="lazy" allowfullscreen />
              </div>
              <p>
                <a href={`https://www.youtube.com/watch?v=${lp.videoId}`} target="_blank" rel="noopener">
                  {lp.title}
                </a>{" "}
                <span class="muted">
                  · {lp.channel} · {fmtNum(lp.views)} просмотров
                </span>
              </p>
            </>
          )}
          {lp.status !== "ok" && <p class="muted">{status[lp.status]}</p>}
          {lp.conclusion && (
            <>
              <p>{lp.conclusion.summary}</p>
              {(lp.conclusion.pros.length > 0 || lp.conclusion.cons.length > 0) && (
                <div class="proscons">
                  <div>
                    <h3 class="pros-title">Блогеру понравилось</h3>
                    <ul>{lp.conclusion.pros.map((p) => <li>{p}</li>)}</ul>
                  </div>
                  <div>
                    <h3 class="cons-title">Не понравилось</h3>
                    <ul>{lp.conclusion.cons.map((p) => <li>{p}</li>)}</ul>
                  </div>
                </div>
              )}
              {lp.conclusion.verdict && (
                <p class="verdict">
                  <strong>Вердикт:</strong> {lp.conclusion.verdict}
                </p>
              )}
            </>
          )}
          {lp.transcript && (
            <details>
              <summary>
                Расшифровка ({lp.transcriptSource === "stt" ? "Whisper" : "субтитры YouTube"}, {fmtNum(lp.transcript.length)} символов)
              </summary>
              <p class="transcript">{lp.transcript}</p>
            </details>
          )}
        </>
      )}
    </section>
  );
};

export const GamePage: FC<{ game: GameFull }> = ({ game }) => (
  <Layout title={`${game.title} — Metacritic Digest`} active="games">
    <a href="/" class="back" onclick="if (history.length > 1 && document.referrer.startsWith(location.origin)) { history.back(); return false; }">
      ← К списку
    </a>
    <article class="game">
      <div class="game__hero">
        <div class="game__cover">{game.coverUrl && <img src={game.coverUrl} alt={game.title} />}</div>
        <div class="game__info">
          <h1>{game.title}</h1>
          <dl class="facts">
            <dt>Разработчик</dt>
            <dd>{game.developer ?? "—"}</dd>
            <dt>Издатель</dt>
            <dd>{game.publisher ?? "—"}</dd>
            <dt>Дата выхода</dt>
            <dd>{fmtDate(game.releaseDate)}</dd>
            <dt>Жанры</dt>
            <dd>{game.genres.join(", ") || "—"}</dd>
            {game.rating && (
              <>
                <dt>Рейтинг ESRB</dt>
                <dd>{game.rating}</dd>
              </>
            )}
          </dl>
          <div class="hero-scores">
            <div>
              <Score value={game.metascore} kind="meta" size="lg" />
              <span>Metascore</span>
            </div>
            <div>
              <Score value={game.userscore} kind="user" size="lg" />
              <span>User score</span>
            </div>
          </div>
          <a href={`https://www.metacritic.com/game/${game.slug}/`} target="_blank" rel="noopener" class="ext">
            Открыть на Metacritic ↗
          </a>
        </div>
      </div>

      {game.description && (
        <section class="panel">
          <h2>Описание</h2>
          <p class="description">{game.description}</p>
        </section>
      )}

      <section class="panel">
        <h2>Платформы и оценки</h2>
        <table class="platforms">
          <thead>
            <tr>
              <th>Платформа</th>
              <th>Metascore</th>
              <th>Критиков</th>
              <th>User score</th>
              <th>Игроков</th>
              <th>Релиз</th>
            </tr>
          </thead>
          <tbody>
            {game.platforms.map((p) => (
              <tr>
                <td>
                  {p.name}
                  {p.isLead && <span class="chip chip--lead">основная</span>}
                </td>
                <td>
                  <Score value={p.metascore} kind="meta" />
                </td>
                <td>{fmtNum(p.criticCount)}</td>
                <td>
                  <Score value={p.userscore} kind="user" />
                </td>
                <td>{fmtNum(p.userCount)}</td>
                <td>{fmtDate(p.releaseDate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {game.videoUrl && (
        <section class="panel">
          <h2>Видео {game.videoTitle && <span class="muted">· {game.videoTitle}</span>}</h2>
          <div class="video">
            <iframe src={game.videoUrl} title={game.videoTitle ?? "Trailer"} loading="lazy" allowfullscreen />
          </div>
          <p>
            <a href={game.videoUrl} target="_blank" rel="noopener">
              Ссылка на видео ↗
            </a>
          </p>
        </section>
      )}

      <div class="two-col">
        <SummaryBlock title="Что говорят критики" data={game.criticSummary} count={game.criticReviewCount} />
        <SummaryBlock title="Что говорят игроки" data={game.userSummary} count={game.userReviewCount} />
      </div>

      <LetsPlayBlock lp={game.letsplay} />

      <section class="panel">
        <h2>Похожие игры</h2>
        {game.similar.length === 0 ? (
          <p class="muted">Похожих игр в базе пока нет.</p>
        ) : (
          <ul class="similar">
            {game.similar.map((s) => (
              <li>
                <a href={`/game/${s.slug}`}>
                  {s.coverUrl && <img src={s.coverUrl} alt="" loading="lazy" />}
                  <span>{s.title}</span>
                  <Score value={s.metascore} kind="meta" />
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </article>
  </Layout>
);

export const MonitorPage: FC = () => (
  <Layout title="Мониторинг — Metacritic Digest" active="monitor">
    <div class="monitor-head">
      <h1>Мониторинг сервиса</h1>
      <div>
        <span id="conn" class="conn">подключение…</span>
        <button id="run-btn" class="btn" type="button">
          Запустить обработку
        </button>
      </div>
    </div>
    <div id="monitor" class="monitor">
      <p class="muted">Загрузка…</p>
    </div>
    <script src="/static/monitor.js" type="module"></script>
  </Layout>
);

export const NotFoundPage: FC = () => (
  <Layout title="Не найдено">
    <div class="empty">
      Страница не найдена. <a href="/">К списку игр</a>
    </div>
  </Layout>
);
