// Live monitoring: subscribes to /api/monitor/stream (SSE) and re-renders the dashboard on each snapshot.
const root = document.getElementById("monitor");
const conn = document.getElementById("conn");
const runBtn = document.getElementById("run-btn");

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const time = (iso) => (iso ? new Date(iso).toLocaleTimeString("ru-RU") : "—");
const dateTime = (s) => (s ? new Date(s.includes("T") ? s : `${s.replace(" ", "T")}Z`).toLocaleString("ru-RU") : "—");
const ago = (iso) => {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  return s < 60 ? `${s} с` : `${Math.floor(s / 60)} мин ${s % 60} с`;
};
const statusRu = { running: "идёт", ok: "успешно", failed: "ошибка", busy: "работает", idle: "ожидает" };
const triggerRu = { schedule: "по расписанию", manual: "вручную", startup: "при старте" };

const card = (label, value) => `<div class="card"><div class="card__label">${label}</div><div class="card__value">${value}</div></div>`;

function render(s) {
  runBtn.disabled = s.running;
  runBtn.textContent = s.running ? "Обработка идёт…" : "Запустить обработку";

  const run = s.run;
  const done = run ? run.scraped + run.failed : 0;
  const pct = run && run.selected ? Math.round((done / run.selected) * 100) : 0;

  const runPanel = run
    ? `<section class="panel">
        <h2>Текущий запуск #${run.id} <span class="badge badge--running">${esc(run.stage)}</span></h2>
        <p class="muted">Запущен ${triggerRu[run.trigger] ?? run.trigger} в ${time(run.startedAt)} · идёт ${ago(run.startedAt)}</p>
        <p>Выбрано игр: <b>${run.selected}</b> · собрано: <b>${run.scraped}</b> · ошибок: <b>${run.failed}</b></p>
        <div class="progress"><div style="width:${pct}%"></div></div>
      </section>`
    : `<section class="panel"><h2>Сервис ожидает</h2>
        <p class="muted">Следующий запуск по расписанию: ${s.nextRunAt ? new Date(s.nextRunAt).toLocaleString("ru-RU") : "—"}</p></section>`;

  const pools = s.pools
    .map(
      (p) => `<section class="panel">
        <h2>${esc(p.title)}</h2>
        <p class="muted">В очереди: <b>${p.queued}</b> · обработано: <b>${p.processed}</b> · ошибок: <b>${p.failed}</b></p>
        ${p.workers
          .map(
            (w) => `<div class="worker">
              <span>${esc(w.id)}</span>
              <span class="badge badge--${w.status}">${statusRu[w.status]}</span>
              <span class="worker__task" title="${esc(w.lastError ?? "")}">${
                w.status === "busy" ? `${esc(w.task)} · ${ago(w.since)}` : w.lastError ? `последняя ошибка: ${esc(w.lastError)}` : "—"
              }</span>
            </div>`,
          )
          .join("")}
      </section>`,
    )
    .join("");

  const runs = s.stats.recentRuns
    .map(
      (r) => `<tr><td>#${r.id}</td><td>${triggerRu[r.trigger] ?? r.trigger}</td>
        <td><span class="badge badge--${r.status}">${statusRu[r.status] ?? r.status}</span></td>
        <td>${dateTime(r.startedAt)}</td><td>${dateTime(r.finishedAt)}</td>
        <td>${r.selected}</td><td>${r.scraped}</td><td>${r.failed}</td><td class="muted">${esc(r.error ?? "")}</td></tr>`,
    )
    .join("");

  const events = s.events
    .map((e) => `<div class="${e.level}">${time(e.at)}  ${esc(e.msg)}</div>`)
    .join("");

  root.innerHTML = `
    <div class="cards">
      ${card("Игр в базе", s.stats.games)}
      ${card("Обработано сегодня", s.stats.processedToday)}
      ${card("Резюме критиков", s.stats.withCriticSummary)}
      ${card("Резюме игроков", s.stats.withUserSummary)}
      ${card("Летсплеев с выводом", s.stats.letsplaysOk)}
    </div>
    ${runPanel}
    <div class="pools">${pools}</div>
    <section class="panel"><h2>История запусков</h2>
      <div style="overflow-x:auto"><table class="runs"><thead><tr><th>#</th><th>Триггер</th><th>Статус</th><th>Начало</th><th>Конец</th>
      <th>Выбрано</th><th>Собрано</th><th>Ошибок</th><th></th></tr></thead><tbody>${runs || '<tr><td colspan="9" class="muted">Запусков ещё не было</td></tr>'}</tbody></table></div>
    </section>
    <section class="panel"><h2>Журнал событий</h2><div class="log">${events || '<span class="muted">Пусто</span>'}</div></section>`;
}

function connect() {
  const es = new EventSource("/api/monitor/stream");
  es.addEventListener("snapshot", (e) => {
    conn.className = "conn conn--live";
    conn.textContent = "online";
    render(JSON.parse(e.data));
  });
  es.onerror = () => {
    conn.className = "conn conn--down";
    conn.textContent = "переподключение…";
  };
}

runBtn.addEventListener("click", async () => {
  runBtn.disabled = true;
  const res = await fetch("/api/run", { method: "POST" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) alert(body.message ?? "Не удалось запустить");
});

connect();
