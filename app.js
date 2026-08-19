/* =========================================================================
 *  F1 Live Dashboard – Frontend
 *  Holt Live-Daten von /api/data (server.js scraped motorsport-total),
 *  rendert Wertungen, nächstes Rennen, Kalender+Karte, Fahrer/Teams,
 *  Saisonverlauf und Head-to-Head. Bilder kommen direkt von der Quelle
 *  (Team-Logos/Streckenbild via Freistell-Proxy); bei Ladefehlern greift
 *  jeweils ein Fallback.
 * ========================================================================= */

const REFRESH_MS = 60_000;        // Auto-Update-Intervall
const COUNTDOWN_MS = 1_000;

let DATA = null;                  // zuletzt geladene Daten (/api/data)
let SEASON = null;                // Saisonübersicht (/api/season)
let PROGRESS = null;              // Saisonverlauf (/api/season-progress)
let sortKey = "pos";
let sortDir = 1;                  // 1 = aufsteigend, -1 = absteigend
let countdownTimer = null;
let driverDeltas = {};            // Name -> { pos, pts } seit letzter Aktualisierung
let teamDeltas = {};              // Team-ID -> { pos, pts } seit letzter Aktualisierung
const raceCache = new Map();      // slug -> Rennergebnis (client-seitig gecacht)
const hiddenDrivers = new Set();  // im Saisonverlauf-Chart ausgeblendete Fahrer (Legende)
let TRACK_SHAPES = null;          // echte Streckenumrisse (assets/track-shapes.json)

const $ = (sel) => document.querySelector(sel);
const el = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstChild; };

/* Schickt Team-Logos/Streckenbilder von motorsport-total.com durch den
   Freistell-Proxy (weißer Hintergrund raus, auf Inhalt zugeschnitten). */
function proxyImg(url) {
  if (!url) return url;
  if (/^https:\/\/(www\.)?motorsport-total\.com\//.test(url)) {
    return "/api/img?src=" + encodeURIComponent(url);
  }
  return url;
}

/* ---- Fallback-Bild (grauer Platzhalter mit F1-Icon) ------------------- */
const FALLBACK = "data:image/svg+xml;utf8," + encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'>
     <rect width='120' height='120' rx='12' fill='#1a1f2b'/>
     <text x='50%' y='54%' font-family='Arial' font-size='30' fill='#3a4252' text-anchor='middle' dominant-baseline='middle'>🏁</text>
   </svg>`
);
function imgFallback(img) {
  img.onerror = () => {
    const second = img.dataset.fallback2;
    if (second && img.src !== second) {
      img.dataset.fallback2 = ""; // nur einmal versuchen
      img.src = second;
      return;
    }
    img.onerror = null; img.src = FALLBACK; img.classList.add("is-fallback");
  };
}
function bindFallbacks(root) { root.querySelectorAll("img[data-fallback]").forEach(imgFallback); }

/* ---- Verlauf für Positions-/Punkte-Trends (nur seit letzter Aktualisierung) -- */
function loadHistory() {
  try { return JSON.parse(localStorage.getItem("f1.history") || "null"); } catch { return null; }
}
function saveHistory(h) {
  try { localStorage.setItem("f1.history", JSON.stringify(h)); } catch { /* ignorieren */ }
}
function computeDeltas(data) {
  const prev = loadHistory();
  const hist = { drivers: {}, teams: {} };
  driverDeltas = {};
  teamDeltas = {};
  for (const d of data.drivers || []) {
    hist.drivers[d.name] = { pos: d.pos, pts: d.points };
    const old = prev && prev.drivers && prev.drivers[d.name];
    if (old) driverDeltas[d.name] = { pos: old.pos - d.pos, pts: d.points - old.pts };
  }
  for (const t of data.teams || []) {
    hist.teams[t.id] = { pos: t.pos, pts: t.points };
    const old = prev && prev.teams && prev.teams[t.id];
    if (old) teamDeltas[t.id] = { pos: old.pos - t.pos, pts: t.points - old.pts };
  }
  saveHistory(hist);
}
function posDeltaBadge(delta) {
  if (!delta || delta.pos === 0) return "";
  const up = delta.pos > 0;
  return `<span class="delta ${up ? "up" : "down"}" title="${up ? "Aufgestiegen" : "Abgestiegen"} seit letzter Aktualisierung">${up ? "▲" : "▼"}${Math.abs(delta.pos)}</span>`;
}
function ptsDeltaBadge(delta) {
  if (!delta || delta.pts === 0) return "";
  return `<span class="delta up" title="Punkte seit letzter Aktualisierung">+${delta.pts}</span>`;
}

/* ---- Obere Navigation (Tabs) -------------------------------------------- */
function initNav() {
  document.querySelectorAll(".nav-tab").forEach((tab) => {
    tab.addEventListener("click", () => showPage(tab.dataset.page));
  });
  const wanted = location.hash.replace("#", "");
  const valid = wanted && document.querySelector(`.nav-tab[data-page="${wanted}"]`);
  showPage(valid ? wanted : "home");
}
function showPage(page) {
  document.querySelectorAll(".page").forEach((p) => p.classList.toggle("active", p.dataset.page === page));
  document.querySelectorAll(".nav-tab").forEach((t) => t.classList.toggle("active", t.dataset.page === page));
  if (history.replaceState) history.replaceState(null, "", "#" + page);
  if (page === "schedule") {
    initScheduleMap();
    const r = SEASON && selectedRound !== null ? SEASON.races.find((x) => x.round === selectedRound) : null;
    updateScheduleMap(r);
    setTimeout(() => {
      const box = document.getElementById("schedule-map");
      if (scheduleGlobe && box && box.clientWidth) scheduleGlobe.width(box.clientWidth).height(box.clientHeight);
    }, 60);
  }
}

/* ---- Laden ------------------------------------------------------------ */
async function load(initial = false) {
  const btn = $("#refresh-btn");
  if (btn) btn.classList.add("spinning");
  try {
    const res = await fetch("/api/data", { cache: "no-store" });
    if (!res.ok) throw new Error("Serverfehler " + res.status);
    const newData = await res.json();
    computeDeltas(newData);
    DATA = newData;
    hideError();
    render();
    $("#loader").classList.add("hidden");
    $("#dashboard").classList.remove("hidden");
    if (initial) { loadSeason(); loadProgress(); }
  } catch (err) {
    if (initial && !DATA) {
      $("#loader").innerHTML = `<p style="color:#ffd7d3">Konnte Daten nicht laden.<br>Läuft der Server (server.js)?<br><small>${err.message}</small></p>`;
    } else {
      showError("Aktualisierung fehlgeschlagen – zeige letzte Daten. (" + err.message + ")");
    }
  } finally {
    if (btn) setTimeout(() => btn.classList.remove("spinning"), 600);
  }
}

/* ---- Rennkalender (Schedule + Results + Home-Kurzfassung) ------------- */
async function loadSeason() {
  try {
    const res = await fetch("/api/season", { cache: "no-store" });
    if (!res.ok) throw new Error("Serverfehler " + res.status);
    SEASON = await res.json();
    renderRaceStrip();
    renderScheduleList();
    renderHomeLastRace();
  } catch (err) {
    $("#race-strip").innerHTML = `<div class="rm-empty">Rennkalender konnte nicht geladen werden.</div>`;
    $("#schedule-list").innerHTML = `<div class="rm-empty">Rennkalender konnte nicht geladen werden.</div>`;
  }
}

function renderRaceStrip() {
  const strip = $("#race-strip");
  if (!SEASON || !SEASON.races || !SEASON.races.length) {
    strip.innerHTML = `<div class="rm-empty">Keine Rennergebnisse verfügbar.</div>`;
    return;
  }
  strip.innerHTML = "";
  for (const r of SEASON.races) {
    const chip = el(`
      <div class="race-chip ${r.hasResult ? "" : "is-future"}" data-slug="${r.slug || ""}" title="${r.hasResult ? "Ergebnis ansehen" : "Noch nicht ausgetragen"}">
        <div class="rc-round">RENNEN ${r.round}</div>
        ${r.flag ? `<img class="rc-flag" data-fallback src="${r.flag}" alt="">` : ""}
        <div class="rc-name">${r.country}</div>
        ${r.hasResult ? `<div class="rc-winner">🏆 ${r.winner}</div>` : `<div class="rc-date">${r.date}</div>`}
      </div>`);
    if (r.hasResult) chip.addEventListener("click", () => openRaceModal(r.slug));
    strip.appendChild(chip);
  }
  bindFallbacks(strip);
}

/* ---- Schedule: Kalenderliste -------------------------------------------- */
let selectedRound = null; // aktuell auf der Karte ausgewähltes Rennen (Schedule-Seite)

function renderScheduleList() {
  const list = $("#schedule-list");
  if (!SEASON || !SEASON.races || !SEASON.races.length) {
    list.innerHTML = `<div class="rm-empty">Kalender konnte nicht geladen werden.</div>`;
    return;
  }
  if (selectedRound === null) {
    const upcoming = SEASON.races.find((r) => !r.hasResult);
    selectedRound = (upcoming || SEASON.races[SEASON.races.length - 1]).round;
  }
  list.innerHTML = "";
  for (const r of SEASON.races) {
    const row = el(`
      <div class="sched-row ${r.hasResult ? "" : "is-future"} ${r.round === selectedRound ? "is-selected" : ""}" data-round="${r.round}">
        <span class="sched-round">R${r.round}</span>
        ${r.flag ? `<img class="rc-flag" data-fallback src="${r.flag}" alt="">` : `<span></span>`}
        <span class="sched-name">${r.country}</span>
        <span class="sched-date">${r.date}</span>
        <span class="sched-winner">${r.hasResult ? "🏆 " + r.winner : "Ausstehend"}</span>
      </div>`);
    row.addEventListener("click", () => selectScheduleRace(r.round));
    list.appendChild(row);
  }
  bindFallbacks(list);
  initScheduleMap();
  buildScheduleMarkers();
  selectScheduleRace(selectedRound);
}

function selectScheduleRace(round) {
  selectedRound = round;
  const r = (SEASON.races || []).find((x) => x.round === round);
  if (!r) return;
  document.querySelectorAll(".sched-row").forEach((row) => row.classList.toggle("is-selected", Number(row.dataset.round) === round));
  updateScheduleMap(r);

  const panel = $("#schedule-detail");
  if (panel) {
    const earthUrl = r.geo
      ? `https://earth.google.com/web/@${r.geo.lat},${r.geo.lng},1000a,6000d,35y,0h,0t,0r`
      : null;
    panel.innerHTML = `
      <div class="sched-detail-inner">
        <div class="sched-detail-info">
          <div class="sched-detail-head">
            ${r.flag ? `<img class="rc-flag" data-fallback src="${r.flag}" alt="">` : ""}
            <div>
              <div class="sched-detail-name">Rennen ${r.round} · ${r.country}</div>
              <div class="sched-detail-date">${r.date}${r.geo ? " · " + r.geo.city : ""}</div>
            </div>
          </div>
          <div class="sched-detail-actions">
            ${r.hasResult
              ? `<button type="button" class="refresh-btn sched-detail-btn">🏆 Sieger: ${r.winner} – Ergebnis ansehen</button>`
              : `<div class="sched-detail-pending">Noch nicht ausgetragen</div>`}
            ${earthUrl ? `<a class="refresh-btn sched-earth-btn" href="${earthUrl}" target="_blank" rel="noopener">🌍 In Google Earth öffnen</a>` : ""}
          </div>
        </div>
        <div class="sched-detail-track">
          ${trackSvg(r.geo && r.geo.track)}
        </div>
      </div>`;
    bindFallbacks(panel);
    const btn = panel.querySelector(".sched-detail-btn");
    if (btn) btn.addEventListener("click", () => openRaceModal(r.slug));
  }
}

/* ---- Schedule: 3D-Globus (globe.gl/three.js) statt flacher Karte --------
   Echte drehbare 3D-Erde im Weltraum (Sternenhimmel-Textur), Rennen als
   anklickbare Flaggen-Pins auf der Oberfläche. Dreht sich von selbst leicht,
   bleibt beim Anklicken eines Rennens auf der ausgewählten Strecke stehen. */
let scheduleGlobe = null;
let scheduleMarkerEls = new Map(); // Runde -> DOM-Element (fürs Auswahl-Highlight)

function raceMarkerEl(r) {
  const el = document.createElement("div");
  el.className = `f1-pin ${r.hasResult ? "is-done" : "is-upcoming"}`;
  el.innerHTML = `<img src="${r.flag || ""}" alt="">${r.hasResult ? `<span class="f1-pin-check">✓</span>` : ""}`;
  el.title = `R${r.round} · ${r.country}${r.hasResult ? " – gefahren" : " – ausstehend"}`;
  el.style.cursor = "pointer";
  el.style.pointerEvents = "auto";
  el.style.transform = "translate(-50%, -50%)";
  el.addEventListener("click", (ev) => { ev.stopPropagation(); selectScheduleRace(r.round); });
  scheduleMarkerEls.set(r.round, el);
  return el;
}

function buildScheduleMarkers() {
  if (!scheduleGlobe || !SEASON || !SEASON.races) return;
  scheduleMarkerEls.clear();
  const withGeo = SEASON.races.filter((r) => r.geo);
  const missing = SEASON.races.filter((r) => !r.geo);
  scheduleGlobe.htmlElementsData(withGeo).htmlElement(raceMarkerEl);
  refreshMarkerSelection();
  updatePinVisibility(scheduleGlobe.pointOfView().altitude);
  updateMarkerFacing();
  const hint = $("#schedule-map-hint");
  if (hint) {
    hint.textContent = missing.length
      ? `Hinweis: ${missing.length} von ${SEASON.races.length} Rennen ohne Kartenposition: ${missing.map((r) => r.country).join(", ")}`
      : `Alle ${SEASON.races.length} Rennen der Saison sind auf der Karte markiert.`;
  }
}
function refreshMarkerSelection() {
  scheduleMarkerEls.forEach((el, round) => el.classList.toggle("is-selected", round === selectedRound));
}

// Winkelabstand zwischen zwei Punkten auf einer Kugel (Großkreis, in Grad).
// Damit lässt sich bestimmen, ob ein Flaggen-Pin gerade auf der dem Betrachter
// zugewandten Seite des Globus liegt oder auf der Rückseite (Winkel > ~90°).
function angularDistDeg(lat1, lng1, lat2, lng2) {
  const r = Math.PI / 180;
  const cosC = Math.sin(lat1 * r) * Math.sin(lat2 * r) + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lng2 - lng1) * r);
  return (Math.acos(Math.min(1, Math.max(-1, cosC))) * 180) / Math.PI;
}
// Pins auf der Rückseite ausblenden -> verhindert das "Wabbeln"/Durchscheinen
// von Flaggen, die eigentlich hinter der Erdkugel liegen sollten.
function updateMarkerFacing() {
  if (!scheduleGlobe || !SEASON || !SEASON.races) return;
  const pov = scheduleGlobe.pointOfView();
  scheduleMarkerEls.forEach((el, round) => {
    const r = SEASON.races.find((x) => x.round === round);
    if (!r || !r.geo) return;
    const d = angularDistDeg(pov.lat, pov.lng, r.geo.lat, r.geo.lng);
    el.classList.toggle("is-backside", d > 87);
  });
}

const TILE_SWITCH_ALTITUDE = 0.18; // ab dieser Kamera-Höhe auf Satellitenkacheln umschalten
const PIN_FADE_ALTITUDE = 0.006; // erst kurz vor dem absoluten Zoom-Maximum ausblenden
const TILE_ENGINE_URL = (x, y, l) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${l}/${y}/${x}`;
let tileEngineActive = false;

function enableTileEngine() {
  if (!scheduleGlobe || tileEngineActive) return;
  tileEngineActive = true;
  scheduleGlobe.globeTileEngineUrl(TILE_ENGINE_URL);
}
function disableTileEngine() {
  if (!scheduleGlobe || !tileEngineActive) return;
  tileEngineActive = false;
  scheduleGlobe.globeTileEngineUrl(null); // zurück zur knackig-scharfen Blue-Marble-Textur
}
function updatePinVisibility(altitude) {
  const hide = altitude < PIN_FADE_ALTITUDE;
  scheduleMarkerEls.forEach((el) => el.classList.toggle("is-fading", hide));
}

function initScheduleMap() {
  const box = document.getElementById("schedule-map");
  if (!box || scheduleGlobe || typeof Globe === "undefined") return;
  scheduleGlobe = Globe()(box)
    // Beim Rauszoomen: eine schöne, hochwertige Blue-Marble-Textur der ganzen Erde
    // (die Satellitenkacheln sind auf niedrigen Zoomstufen selbst eher unscharf).
    .globeImageUrl("https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg")
    .bumpImageUrl("https://unpkg.com/three-globe/example/img/earth-topology.png")
    .globeTileEngineMaxLevel(19)
    .backgroundImageUrl("https://unpkg.com/three-globe/example/img/night-sky.png")
    .showAtmosphere(true)
    .atmosphereColor("#4d8fe0")
    .atmosphereAltitude(0.2)
    .width(box.clientWidth)
    .height(box.clientHeight)
    .htmlElementsData([])
    .htmlLat((d) => d.geo.lat)
    .htmlLng((d) => d.geo.lng)
    .htmlAltitude(0)
    // Beim Reinzoomen: automatisch auf echte Satellitenkacheln umschalten (wie
    // Google Earth), damit man bis auf Streckenebene sehen kann. Die Flaggen
    // blenden sich dabei erst kurz vor der Strecke aus, damit man vorher immer
    // sieht, wo überhaupt die Strecke liegt.
    .onZoom((pov) => {
      if (pov.altitude < TILE_SWITCH_ALTITUDE) enableTileEngine();
      else disableTileEngine();
      updatePinVisibility(pov.altitude);
      updateMarkerFacing();
    });

  scheduleGlobe.pointOfView({ lat: 20, lng: 10, altitude: 2.5 }, 0);
  const controls = scheduleGlobe.controls();
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.35;
  controls.minDistance = 100.05; // fast bis auf die Oberfläche ran (Streckenebene), kaum spürbare Grenze
  controls.maxDistance = 700;
  controls.zoomSpeed = 0.7;
  // Auto-Drehung sofort stoppen, sobald man selbst dreht/zoomt/tippt -
  // sonst "kämpft" die eigene Bedienung gegen die automatische Drehung
  // und fühlt sich wabbelig/unkontrollierbar an.
  controls.addEventListener("start", () => { controls.autoRotate = false; });

  // Mobilgeräte: Pixel-Ratio deckeln (spart GPU-Last, sonst kann die
  // Bedienung auf schwächeren Handys ruckelig/ungenau wirken) und auf
  // Größenänderungen zuverlässiger reagieren (resize feuert auf manchen
  // mobilen Browsern verzögert oder gar nicht bei Rotation).
  try {
    const renderer = scheduleGlobe.renderer && scheduleGlobe.renderer();
    if (renderer && renderer.setPixelRatio) renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  } catch { /* renderer()-API evtl. nicht verfügbar -> ignorieren, kein Hard-Fail */ }

  const syncSize = () => {
    if (!scheduleGlobe || !box.clientWidth) return;
    scheduleGlobe.width(box.clientWidth).height(box.clientHeight);
  };
  window.addEventListener("resize", syncSize);
  window.addEventListener("orientationchange", () => setTimeout(syncSize, 300));
  if (window.visualViewport) window.visualViewport.addEventListener("resize", syncSize);
}
function updateScheduleMap(race) {
  const r = race || (DATA && DATA.nextRace);
  if (!r) return;
  initScheduleMap();
  if (!scheduleGlobe) return;
  if (scheduleMarkerEls.size === 0) buildScheduleMarkers();
  refreshMarkerSelection();
  const note = $("#schedule-map-note");
  const geo = r.geo;
  if (!geo) {
    if (note) note.textContent = `Keine Kartenposition für „${r.circuit || r.country}“ hinterlegt.`;
    return;
  }
  if (note) note.textContent = "";
  const controls = scheduleGlobe.controls();
  if (race) controls.autoRotate = false; // beim gezielten Anfliegen einer Strecke stehen bleiben
  const targetAltitude = 0.0015; // praktisch komplett reingezoomt, bis auf Streckenebene (nah am technischen Minimum)
  enableTileEngine();
  updatePinVisibility(targetAltitude);
  scheduleGlobe.pointOfView({ lat: geo.lat, lng: geo.lng, altitude: targetAltitude }, 1800);
}

/* ---- Saisonverlauf-Chart (Stats) --------------------------------------- */
async function loadProgress() {
  try {
    const res = await fetch("/api/season-progress", { cache: "no-store" });
    if (!res.ok) throw new Error("Serverfehler " + res.status);
    PROGRESS = await res.json();
    renderChart();
    renderChampBars();
    renderDestructors();
    populateCompareSelectors();
    renderCompare();
    populateStatsSelector();
    renderDriverStats();
  } catch (err) {
    $("#chart-wrap").innerHTML = `<div class="sc-empty">Saisonverlauf konnte nicht geladen werden.<br><small>${err.message}</small></div>`;
    $("#compare-body").innerHTML = `<div class="sc-empty">Vergleich konnte nicht geladen werden.</div>`;
    $("#driver-stats-body").innerHTML = `<div class="sc-empty">Fahrer-Stats konnten nicht geladen werden.</div>`;
  }
}

function renderChart() {
  const wrap = $("#chart-wrap");
  const legend = $("#chart-legend");
  if (!PROGRESS || !PROGRESS.totalRounds || !PROGRESS.rounds.length || !PROGRESS.drivers.length) {
    wrap.innerHTML = `<div class="sc-empty">Noch keine Rennergebnisse für den Saisonverlauf.</div>`;
    legend.innerHTML = "";
    return;
  }
  const { rounds, drivers, totalRounds } = PROGRESS;
  const maxPts = Math.max(10, ...drivers.map((d) => d.total));
  // Breite/Skala richten sich nach der GESAMTEN Saison (nicht nur den bereits
  // gefahrenen Rennen) -> das Diagramm wirkt nicht "gezogen", wenn erst
  // wenige Rennen stattgefunden haben. Der Rest bleibt einfach leer.
  const W = Math.max(560, totalRounds * 42);
  const H = 300;
  const padL = 38, padR = 16, padT = 14, padB = 30;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const denom = Math.max(1, totalRounds - 1);
  const xAt = (roundIdx) => padL + (roundIdx / denom) * plotW;
  const yAt = (v) => padT + plotH - (v / maxPts) * plotH;

  let gridHtml = "";
  const steps = 4;
  for (let s = 0; s <= steps; s++) {
    const v = Math.round((maxPts / steps) * s);
    const y = yAt(v);
    gridHtml += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" class="chart-grid"/>`;
    gridHtml += `<text x="${padL - 8}" y="${y + 4}" class="chart-axis-y" text-anchor="end">${v}</text>`;
  }
  let xLabelHtml = "";
  for (let i = 0; i < totalRounds; i++) {
    xLabelHtml += `<text x="${xAt(i)}" y="${H - 8}" class="chart-axis-x" text-anchor="middle">${i + 1}</text>`;
  }
  // Trennlinie: bis hierhin wurde bereits gefahren, Rest der Saison ist noch offen
  const racedIdx = rounds.length - 1;
  const nowLine = racedIdx < totalRounds - 1
    ? `<line x1="${xAt(racedIdx)}" y1="${padT}" x2="${xAt(racedIdx)}" y2="${H - padB}" class="chart-now-line"/>`
    : "";

  let linesHtml = "";
  [...drivers].reverse().forEach((d) => { // schwächere zuerst zeichnen, damit Topfahrer oben liegen
    if (hiddenDrivers.has(d.key) || !d.series.length) return;
    const pts = d.series.map((v, i) => `${xAt(i)},${yAt(v)}`).join(" ");
    linesHtml += `<polyline points="${pts}" fill="none" stroke="${d.teamColor}" stroke-width="2.5" class="chart-line"/>`;
    const lastX = xAt(d.series.length - 1);
    const lastY = yAt(d.series[d.series.length - 1]);
    linesHtml += `<circle cx="${lastX}" cy="${lastY}" r="3.5" fill="${d.teamColor}" class="chart-dot"/>`;
  });

  wrap.innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="chart-svg" style="width:${W}px" preserveAspectRatio="none">${gridHtml}${nowLine}${linesHtml}${xLabelHtml}</svg>`;

  legend.innerHTML = "";
  drivers.forEach((d) => {
    const off = hiddenDrivers.has(d.key);
    const chip = el(`<button type="button" class="legend-chip ${off ? "is-off" : ""}" style="--lc:${d.teamColor}">
      <span class="legend-dot"></span>${d.display} <b>${d.total}</b>
    </button>`);
    chip.addEventListener("click", () => {
      if (hiddenDrivers.has(d.key)) hiddenDrivers.delete(d.key); else hiddenDrivers.add(d.key);
      renderChart();
    });
    legend.appendChild(chip);
  });
}

/* ---- Fahrer-Stats (individuell) ----------------------------------------- */
function populateStatsSelector() {
  if (!PROGRESS || !PROGRESS.drivers.length) return;
  const sel = $("#stats-driver");
  const options = PROGRESS.drivers.map((d) => `<option value="${d.key}">${d.display}</option>`).join("");
  const prev = localStorage.getItem("stats.driver") || PROGRESS.drivers[0].key;
  sel.innerHTML = options;
  sel.value = prev;
  if (!sel.value) sel.value = PROGRESS.drivers[0].key;
}

function renderDriverStats() {
  const box = $("#driver-stats-body");
  const drivers = (PROGRESS && PROGRESS.drivers) || [];
  const d = drivers.find((x) => x.key === $("#stats-driver").value) || drivers[0];
  if (!d) { box.innerHTML = `<div class="sc-empty">Noch keine Fahrer-Stats verfügbar.</div>`; return; }
  const tile = (val, label, emoji) => `<div class="dstat-tile"><div class="dstat-val">${emoji ? emoji + " " : ""}${val}</div><div class="dstat-label">${label}</div></div>`;
  box.innerHTML = `
    <div class="dstat-head" style="--tc:${d.teamColor}">
      <img class="dstat-photo" data-fallback data-fallback2="${d.photoFallback || ''}" src="${d.photo || ''}" alt="${d.display}">
      <div>
        <div class="dstat-name">${d.display}${d.natFlag ? ` <img class="nat-flag" data-fallback src="${d.natFlag}" alt="">` : ""}</div>
        <div class="dstat-team">${d.teamName || ""}</div>
      </div>
    </div>
    <div class="dstat-grid">
      ${tile(d.wins, "Siege", "🏆")}
      ${tile(d.podiums, "Podien", "🥉")}
      ${tile(d.total, "Punkte", "⭐")}
      ${tile(d.avgPoints, "Ø Punkte/Rennen", "📊")}
      ${tile(d.bestPos ? "P" + d.bestPos : "—", "Bestes Ergebnis", "🎯")}
      ${tile(d.starts, "Starts", "🏁")}
      ${tile(d.incidents, "Ausfälle", "💥")}
      ${tile(d.starts ? Math.round(((d.starts - d.incidents) / d.starts) * 100) + "%" : "—", "Finish-Quote", "✅")}
    </div>`;
  bindFallbacks(box);
}

/* ---- Head to Head ------------------------------------------------------- */
function populateCompareSelectors() {
  if (!PROGRESS || !PROGRESS.drivers.length) return;
  const aSel = $("#compare-a"), bSel = $("#compare-b");
  const options = `<option value="">— Fahrer wählen —</option>` +
    PROGRESS.drivers.map((d) => `<option value="${d.key}">${d.display}</option>`).join("");
  const aPrev = localStorage.getItem("compare.a") || (PROGRESS.drivers[0] || {}).key || "";
  const bPrev = localStorage.getItem("compare.b") || (PROGRESS.drivers[1] || {}).key || "";
  aSel.innerHTML = options; bSel.innerHTML = options;
  aSel.value = aPrev; bSel.value = bPrev;
}

function renderCompare() {
  const body = $("#compare-body");
  const drivers = (PROGRESS && PROGRESS.drivers) || [];
  const a = drivers.find((d) => d.key === $("#compare-a").value);
  const b = drivers.find((d) => d.key === $("#compare-b").value);
  if (!a || !b) { body.innerHTML = `<div class="sc-empty">Wähle oben zwei Fahrer zum Vergleichen 🏁</div>`; return; }

  const rows = [["Punkte", a.total, b.total], ["Siege", a.wins, b.wins], ["Podien", a.podiums, b.podiums]];
  const card = (d) => `
    <div class="cmp-card" style="--tc:${d.teamColor}">
      <img class="cmp-photo" data-fallback data-fallback2="${d.photoFallback || ''}" src="${d.photo || ''}" alt="${d.display}">
      <div class="cmp-name">${d.display}${d.natFlag ? ` <img class="nat-flag" data-fallback src="${d.natFlag}" alt="">` : ""}</div>
      <div class="cmp-team">${d.teamName || ""}</div>
    </div>`;
  const rowsHtml = rows.map(([label, av, bv]) => `
    <div class="cmp-row">
      <div class="cmp-val ${av > bv ? "cmp-win" : ""}">${av}</div>
      <div class="cmp-label">${label}</div>
      <div class="cmp-val ${bv > av ? "cmp-win" : ""}">${bv}</div>
    </div>`).join("");
  body.innerHTML = `<div class="cmp-grid">${card(a)}<div class="cmp-stats">${rowsHtml}</div>${card(b)}</div>`;
  bindFallbacks(body);
}

/* ---- Home ---------------------------------------------------------------- */
function renderHome() {
  if (!DATA) return;
  const topD = $("#home-top-drivers");
  topD.innerHTML = DATA.drivers.slice(0, 3).map((d, i) => `
    <div class="home-top-row" style="--rc:${d.teamColor}">
      <span class="home-top-medal">${["🥇", "🥈", "🥉"][i] || ""}</span>
      <img class="home-top-photo" data-fallback data-fallback2="${d.photoFallback || ''}" src="${d.photo || ''}" alt="">
      <div class="home-top-meta"><div class="home-top-name">${d.display}</div><div class="home-top-sub">${d.teamName}</div></div>
      <div class="home-top-pts">${d.points}</div>
    </div>`).join("") || `<div class="sc-empty">Keine Daten.</div>`;
  bindFallbacks(topD);

  const topT = $("#home-top-teams");
  topT.innerHTML = DATA.teams.slice(0, 3).map((t, i) => `
    <div class="home-top-row" style="--rc:${t.color}">
      <span class="home-top-medal">${["🥇", "🥈", "🥉"][i] || ""}</span>
      <img class="home-top-photo home-top-logo" data-fallback src="${proxyImg(t.logo || t.car || "")}" alt="">
      <div class="home-top-meta"><div class="home-top-name">${t.name}</div><div class="home-top-sub">${(t.drivers || []).join(", ")}</div></div>
      <div class="home-top-pts">${t.points}</div>
    </div>`).join("") || `<div class="sc-empty">Keine Daten.</div>`;
  bindFallbacks(topT);
}

async function renderHomeLastRace() {
  const box = $("#home-last-race");
  if (!box) return;
  if (!SEASON || !SEASON.races) { box.innerHTML = `<div class="sc-empty">—</div>`; return; }
  const raced = SEASON.races.filter((r) => r.hasResult).sort((a, b) => b.round - a.round);
  if (!raced.length) { box.innerHTML = `<div class="sc-empty">Noch kein Rennen gefahren.</div>`; return; }
  const last = raced[0];
  box.innerHTML = `<div class="rm-loading"><div class="start-lights" style="transform:scale(0.5);transform-origin:left center;"><span class="light"></span><span class="light"></span><span class="light"></span><span class="light"></span><span class="light"></span></div>Lade …</div>`;
  try {
    let race = raceCache.get(last.slug);
    if (!race) {
      const res = await fetch(`/api/race?slug=${encodeURIComponent(last.slug)}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Serverfehler " + res.status);
      race = await res.json();
      if (race.error) throw new Error(race.error);
      raceCache.set(last.slug, race);
    }
    const top3 = (race.results || []).slice(0, 3);
    box.innerHTML = `
      <div class="home-last-head">
        ${last.flag ? `<img class="rc-flag" data-fallback src="${last.flag}" alt="">` : ""}
        <div><div class="home-last-name">${last.country}</div><div class="home-last-date">${last.date}</div></div>
      </div>
      <div class="home-last-podium">
        ${top3.map((r) => {
          const d = findDriverByShort(r.driverShort);
          return `<div class="home-last-row"><span class="home-last-pos">P${r.pos}</span><span class="home-last-driver">${d ? d.display : r.driverShort}</span><span class="home-last-team">${r.team}</span></div>`;
        }).join("") || `<div class="sc-empty">Keine Daten.</div>`}
      </div>
      <button type="button" class="refresh-btn home-last-btn">Volles Ergebnis ansehen</button>`;
    bindFallbacks(box);
    const btn = box.querySelector(".home-last-btn");
    if (btn) btn.addEventListener("click", () => { showPage("results"); openRaceModal(last.slug); });
  } catch (err) {
    box.innerHTML = `<div class="sc-empty">Letztes Rennen konnte nicht geladen werden.</div>`;
  }
}

/* ---- Fahrer/Teams (Grid-Übersichten) ------------------------------------ */
function renderDriversGrid() {
  const grid = $("#drivers-grid");
  if (!DATA) return;
  const q = ($("#drivers-grid-search").value || "").trim().toLowerCase();
  const rows = DATA.drivers.filter((d) => !q || d.display.toLowerCase().includes(q) || d.teamName.toLowerCase().includes(q));
  const team = (id) => DATA.teams.find((t) => t.id === id) || {};
  grid.innerHTML = rows.map((d) => {
    const t = team(d.teamId);
    const fav = isFavDriver(d);
    return `
    <div class="driver-hero ${fav ? "is-favorite" : ""}" style="--tc:${d.teamColor}">
      <div class="driver-hero-photo-wrap">
        <img class="driver-hero-photo" data-fallback data-fallback2="${d.photoFallback || ''}" src="${d.photo || ''}" alt="${d.display}">
        <div class="driver-hero-pos">P${d.pos}</div>
        ${fav ? `<div class="driver-hero-fav" title="Dein Lieblingsfahrer">⭐</div>` : ""}
      </div>
      <div class="driver-hero-body">
        <div class="driver-hero-name">${d.display}${d.natFlag ? ` <img class="nat-flag" data-fallback src="${d.natFlag}" alt="">` : ""}</div>
        <div class="driver-hero-team">
          ${t.logo ? `<img class="driver-hero-logo" data-fallback src="${proxyImg(t.logo)}" alt="${d.teamName}">` : ""}
          <span>${d.teamName}</span>
        </div>
        <div class="driver-hero-stats">
          <div class="driver-hero-stat"><b>${d.points}</b><span>Punkte</span></div>
          <div class="driver-hero-stat"><b>${d.natCode || "—"}</b><span>Nation</span></div>
        </div>
      </div>
    </div>`;
  }).join("") || `<div class="sc-empty">Keine Treffer.</div>`;
  bindFallbacks(grid);
}
function renderTeamsGrid() {
  const grid = $("#teams-grid");
  if (!DATA) return;
  const q = ($("#teams-grid-search").value || "").trim().toLowerCase();
  const rows = DATA.teams.filter((t) => !q || t.name.toLowerCase().includes(q));
  grid.innerHTML = rows.map((t) => {
    const drivers = DATA.drivers.filter((d) => d.teamId === t.id);
    const carImg = t.carImage2026 || t.car || "";
    const carFallback2 = t.carImage2026 && t.car ? proxyImg(t.car) : "";
    return `
    <div class="team-hero" style="--tc:${t.color}">
      <div class="team-hero-left">
        <div class="team-hero-top">
          <img class="team-hero-logo" data-fallback src="${proxyImg(t.logo || "")}" alt="${t.name}">
          <div>
            <div class="team-hero-name">${t.name}</div>
            <div class="team-hero-chassis">${[t.chassis, t.engine ? `Motor: ${t.engine}` : null].filter(Boolean).join(" · ")}</div>
          </div>
        </div>
        <div class="team-hero-faces">
          ${drivers.map((d) => `
            <div class="team-hero-face">
              <img data-fallback data-fallback2="${d.photoFallback || ''}" src="${d.photo || ''}" alt="${d.display}">
              <div class="team-hero-face-name">${d.display}${d.natFlag ? ` <img class="nat-flag" data-fallback src="${d.natFlag}" alt="">` : ""}</div>
            </div>`).join("") || `<div class="sc-empty">Keine Fahrerdaten.</div>`}
        </div>
        <div class="team-hero-stats">
          <div class="team-hero-stat"><b>P${t.pos}</b><span>Position</span></div>
          <div class="team-hero-stat"><b>${t.points}</b><span>Punkte</span></div>
        </div>
      </div>
      <div class="team-hero-right">
        ${carImg ? `<img class="team-hero-car" data-fallback data-fallback2="${carFallback2}" src="${proxyImg(carImg)}" alt="Auto ${t.name}">` : `<div class="sc-empty">Kein Autobild</div>`}
      </div>
    </div>`;
  }).join("") || `<div class="sc-empty">Keine Treffer.</div>`;
  bindFallbacks(grid);
}

/* ---- Favoriten (Home) --------------------------------------------------- */
function getFavDriverName() { return localStorage.getItem("fav.driver") || ""; }
function isFavDriver(d) { return !!(d && d.name && d.name === getFavDriverName()); }

function populateSelectors() {
  const dsel = $("#fav-driver"), tsel = $("#fav-team");
  if (!dsel || !tsel || !DATA) return;
  const dPrev = dsel.value || localStorage.getItem("fav.driver") || "";
  const tPrev = tsel.value || localStorage.getItem("fav.team") || "";
  dsel.innerHTML = `<option value="">— Fahrer wählen —</option>` +
    DATA.drivers.map((d) => `<option value="${d.name}">${d.display}</option>`).join("");
  tsel.innerHTML = `<option value="">— Team wählen —</option>` +
    DATA.teams.map((t) => `<option value="${t.id}">${t.name}</option>`).join("");
  dsel.value = dPrev; tsel.value = tPrev;
}

function renderDriverShowcase() {
  const box = $("#driver-showcase");
  if (!box || !DATA) return;
  const favName = $("#fav-driver").value;
  const d = DATA.drivers.find((x) => x.name === favName);
  if (!d) { box.innerHTML = `<div class="sc-empty">Wähle oben deinen Lieblingsfahrer 🏎️</div>`; return; }
  const team = DATA.teams.find((t) => t.id === d.teamId) || {};
  box.style.setProperty("--tc", d.teamColor);
  box.innerHTML = `
    <div class="sc-body">
      <div class="sc-content">
        <div class="sc-top">
          ${team.logo ? `<img class="sc-logo" data-fallback src="${proxyImg(team.logo)}" alt="${d.teamName}">` : ""}
          <div>
            <div class="sc-team-name">${d.teamName}</div>
            <div class="sc-driver-name">${d.display}</div>
          </div>
        </div>
        <div class="sc-photo-wrap">
          <img class="sc-photo" data-fallback data-fallback2="${d.photoFallback || ''}" src="${d.photo || ''}" alt="${d.display}">
          <div class="sc-stats">
            <div class="sc-stat"><b>P${d.pos}</b><span>Position</span></div>
            <div class="sc-stat"><b>${d.points}</b><span>Punkte</span></div>
            <div class="sc-stat"><b>#${d.pos}</b><span>WM-Rang</span></div>
            <div class="sc-stat"><span>Nation</span>
              <div class="with-flag">${d.natFlag ? `<img class="nat-flag" data-fallback src="${d.natFlag}" alt="">` : ""}<b style="font-size:16px">${d.natCode || "—"}</b></div>
            </div>
          </div>
        </div>
        ${(team.carImage2026 || team.car) ? `<div class="sc-car"><img data-fallback src="${proxyImg(team.carImage2026 || team.car)}" alt="Auto ${d.teamName}"></div>` : ""}
      </div>
    </div>`;
  bindFallbacks(box);
}

function renderTeamShowcase() {
  const box = $("#team-showcase");
  if (!box || !DATA) return;
  const id = $("#fav-team").value;
  const t = DATA.teams.find((x) => x.id === id);
  if (!t) { box.innerHTML = `<div class="sc-empty">Wähle oben dein Lieblingsteam 🏁</div>`; return; }
  box.style.setProperty("--tc", t.color);
  box.innerHTML = `
    <div class="sc-body">
      <div class="sc-content">
        <div class="sc-top">
          ${t.logo ? `<img class="sc-logo" data-fallback src="${proxyImg(t.logo)}" alt="${t.name}">` : ""}
          <div>
            <div class="sc-team-name">Konstrukteur${t.engine ? ` · ${t.engine}` : ""}</div>
            <div class="sc-driver-name">${t.name}</div>
          </div>
        </div>
        <div class="sc-photo-wrap" style="align-items:center">
          <div class="sc-stats">
            <div class="sc-stat"><b>P${t.pos}</b><span>Position</span></div>
            <div class="sc-stat"><b>${t.points}</b><span>Punkte</span></div>
          </div>
        </div>
        <div class="sc-drivers">${(t.drivers || []).map((n) => `<span class="sc-chip">${n}</span>`).join("")}</div>
        ${(t.carImage2026 || t.car) ? `<div class="sc-car"><img data-fallback src="${proxyImg(t.carImage2026 || t.car)}" alt="Auto ${t.name}"></div>` : ""}
      </div>
    </div>`;
  bindFallbacks(box);
}

/* ---- Rennergebnis-Modal (Results/Schedule/Home) -------------------------- */
function normalizeName(s) {
  return (s || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}
function findDriverByShort(shortName) {
  if (!DATA) return null;
  const parts = shortName.replace(".", "").trim().split(/\s+/);
  const surname = normalizeName(parts[parts.length - 1]);
  return DATA.drivers.find((d) => normalizeName(d.display).includes(surname) || normalizeName(d.name).includes(surname)) || null;
}

async function openRaceModal(slug) {
  const modal = $("#race-modal");
  const body = $("#race-modal-body");
  modal.classList.remove("hidden");
  body.innerHTML = `<div class="rm-loading"><div class="start-lights" style="transform:scale(0.5);transform-origin:left center;"><span class="light"></span><span class="light"></span><span class="light"></span><span class="light"></span><span class="light"></span></div>Lade Rennergebnis …</div>`;

  try {
    let race = raceCache.get(slug);
    if (!race) {
      const res = await fetch(`/api/race?slug=${encodeURIComponent(slug)}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Serverfehler " + res.status);
      race = await res.json();
      if (race.error) throw new Error(race.error);
      raceCache.set(slug, race);
    }
    renderRaceModal(race);
  } catch (err) {
    body.innerHTML = `<div class="rm-empty">Ergebnis konnte nicht geladen werden.<br><small>${err.message}</small></div>`;
  }
}

function renderRaceModal(race) {
  const body = $("#race-modal-body");
  const dnsWords = /nicht angetreten|nicht gestartet|dns/i;
  const rowsHtml = (list, section) => list.map((r) => {
    const d = findDriverByShort(r.driverShort);
    const rc = d ? d.teamColor : "#888";
    const classified = section !== "dnf"; // hat eine echte Position (auch wenn nachträglich ausgefallen)
    const podium = classified && !r.dnf && r.pos <= 3 ? `podium-${r.pos}` : "";
    const statusLabel = dnsWords.test(r.reason || "") ? "DNS" : "DNF";
    const posCell = classified ? r.pos : statusLabel;
    return `
      <tr class="rm-row ${r.dnf ? "rm-row-dnf" : ""}" style="--rc:${rc}">
        <td class="rm-pos ${podium}">${posCell}</td>
        <td>
          <div class="rm-driver">
            ${d && d.photo ? `<img data-fallback data-fallback2="${d.photoFallback || ''}" src="${d.photo}" alt="">` : ""}
            <span>${d ? d.display : r.driverShort}</span>
            ${r.dnf ? `<span class="rm-dnf-badge">${classified ? statusLabel : ""}</span>` : ""}
          </div>
          ${r.dnf && r.reason ? `<div class="rm-reason">Ausfall: ${r.reason}</div>` : ""}
          ${r.penalty ? `<div class="rm-penalty">⚠ ${r.penalty}</div>` : ""}
        </td>
        <td>${r.team}</td>
        <td class="rm-gap">${classified ? (r.gapLeader || "") : (r.laps ? r.laps + " Rnd." : "")}</td>
        <td class="rm-pts">${classified ? r.points : "0"}</td>
      </tr>`;
  }).join("");

  const sessionTables = (race.sessions || []).map((s) => {
    const rows = s.rows.map((r) => {
      const d = findDriverByShort(r.driverShort);
      const rc = d ? d.teamColor : "#888";
      return `
        <tr class="rm-row" style="--rc:${rc}">
          <td class="rm-pos">${r.pos != null ? r.pos : "-"}</td>
          <td>
            <div class="rm-driver">
              ${d && d.photo ? `<img data-fallback data-fallback2="${d.photoFallback || ''}" src="${d.photo}" alt="">` : ""}
              <span>${d ? d.display : r.driverShort}</span>
            </div>
          </td>
          <td>${r.team}</td>
          <td class="rm-gap">${r.c1 || ""}</td>
          <td class="rm-gap">${r.c2 || ""}</td>
        </tr>`;
    }).join("");
    return `
      <details class="rm-session">
        <summary>${s.label} <span class="rm-session-count">(${s.rows.length})</span></summary>
        <table class="rm-table rm-table-compact">
          <thead><tr><th>Pos.</th><th>Fahrer</th><th>Team</th><th>Zeit/Ergebnis</th><th>Rückstand</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </details>`;
  }).join("");

  body.innerHTML = `
    <div class="rm-head">
      ${race.flag ? `<img class="rm-flag" src="${race.flag}" alt="">` : ""}
      <div class="rm-title">${race.name}</div>
    </div>
    <div class="rm-sub">Rennen ${race.round} · ${race.date}</div>
    ${sessionTables ? `<div class="rm-section-title">Training / Qualifying / Sprint</div>${sessionTables}` : ""}
    <div class="rm-section-title">Rennergebnis</div>
    <table class="rm-table">
      <thead><tr><th>Pos.</th><th>Fahrer</th><th>Team</th><th>Rückstand</th><th>Punkte</th></tr></thead>
      <tbody>${rowsHtml(race.results, "results") || `<tr><td colspan="5" class="rm-empty">Keine Daten</td></tr>`}</tbody>
    </table>
    ${race.dnf && race.dnf.length ? `
      <div class="rm-section-title">Ausfälle / Nicht gestartet</div>
      <table class="rm-table">
        <thead><tr><th>Status</th><th>Fahrer</th><th>Team</th><th>Runden</th><th>Punkte</th></tr></thead>
        <tbody>${rowsHtml(race.dnf, "dnf")}</tbody>
      </table>` : ""}`;
  bindFallbacks(body);
}

function closeRaceModal() { $("#race-modal").classList.add("hidden"); }

function showError(msg) { const b = $("#error-banner"); b.textContent = "⚠ " + msg; b.classList.remove("hidden"); }
function hideError() { $("#error-banner").classList.add("hidden"); }

/* ---- Gesamt-Render ---------------------------------------------------- */
function render() {
  if (!DATA) return;
  $("#subtitle").textContent = `Saison ${DATA.season} · nach ${DATA.raceCount} Rennen`;
  $("#schedule-title").textContent = `Rennkalender ${DATA.season}`;
  $("#updated").textContent = "Aktualisiert: " + new Date(DATA.updated).toLocaleTimeString("de-DE");
  if (DATA.errors && Object.keys(DATA.errors).length) {
    showError("Einige Quellen antworteten nicht vollständig: " + Object.keys(DATA.errors).join(", "));
  }
  renderNextRace();
  renderDriverTable();
  renderTeamTable();
  renderChampBars();
  renderDriversGrid();
  renderTeamsGrid();
  renderHome();
  renderDestructors();
  populateSelectors();
  renderDriverShowcase();
  renderTeamShowcase();
  renderNewsHighlight();
  loadWeather();
  if (selectedRound === null) updateScheduleMap();
}

/* ---- Nächstes Rennen (Home) -------------------------------------------- */
async function loadTrackShapes() {
  try {
    const res = await fetch("/assets/track-shapes.json", { cache: "force-cache" });
    if (res.ok) TRACK_SHAPES = await res.json();
  } catch { /* Fallback bleibt aktiv */ }
}

const GENERIC_TRACK_D = "M70,190 C25,190 20,140 55,125 L150,100 C170,95 172,70 150,60 " +
  "L100,48 C65,42 62,22 100,18 L270,18 C310,18 322,44 292,58 L235,84 " +
  "C215,93 218,118 245,124 L330,145 C368,155 366,196 322,200 L120,200 " +
  "C95,200 78,198 70,190 Z";

let trackSvgCounter = 0;
function trackSvg(trackKey) {
  const shape = trackKey && TRACK_SHAPES && TRACK_SHAPES[trackKey];
  const d = shape ? shape.d : GENERIC_TRACK_D;
  const vb = shape ? "0 0 400 220" : "0 0 400 220";
  const pathId = `trackPath-${++trackSvgCounter}`; // eindeutig, sonst kollidieren Home + Schedule im DOM
  return `
    <svg viewBox="${vb}" class="track-svg" xmlns:xlink="http://www.w3.org/1999/xlink" aria-hidden="true">
      <path class="track-path-bg" d="${d}"/>
      <path id="${pathId}" class="track-path-fg" d="${d}"/>
      <circle r="5" class="track-car">
        <animateMotion dur="5.5s" repeatCount="indefinite" rotate="auto">
          <mpath href="#${pathId}" xlink:href="#${pathId}"/>
        </animateMotion>
      </circle>
    </svg>`;
}

/* ---- Wetter (Home) ------------------------------------------------------ */
async function loadWeather() {
  const box = $("#weather-widget");
  if (!box) return;
  try {
    const res = await fetch("/api/weather", { cache: "no-store" });
    const w = await res.json();
    if (w.error || !w.current) { box.innerHTML = ""; return; }

    const nr = DATA && DATA.nextRace;
    let raceDayEntry = null;
    if (nr && nr.raceTimestamp) {
      const raceDate = new Date(nr.raceTimestamp).toISOString().slice(0, 10);
      raceDayEntry = (w.daily || []).find((d) => d.date === raceDate);
    }

    const forecastStrip = (w.daily || []).slice(0, 5).map((d) => {
      const dayLabel = new Date(d.date).toLocaleDateString("de-DE", { weekday: "short" });
      const isRaceDay = raceDayEntry && d.date === raceDayEntry.date;
      return `
        <div class="weather-day ${isRaceDay ? "is-raceday" : ""}" title="${d.label}">
          <div class="weather-day-label">${isRaceDay ? "🏁 " : ""}${dayLabel}</div>
          <div class="weather-day-icon">${d.icon}</div>
          <div class="weather-day-temp">${d.max}° / ${d.min}°</div>
          ${d.precipProb != null ? `<div class="weather-day-precip">💧${d.precipProb}%</div>` : ""}
        </div>`;
    }).join("");

    box.innerHTML = `
      <div class="weather-head">
        <div class="weather-now">
          <span class="weather-now-icon">${w.current.icon}</span>
          <div>
            <div class="weather-now-temp">${w.current.temp}°C</div>
            <div class="weather-now-label">${w.current.label} · ${w.city || ""}${w.current.wind != null ? ` · 💨 ${w.current.wind} km/h` : ""}</div>
          </div>
        </div>
        ${raceDayEntry ? `<div class="weather-raceday-note">🏁 Rennwetter-Vorschau: ${raceDayEntry.icon} ${raceDayEntry.max}° / ${raceDayEntry.min}°, ${raceDayEntry.precipProb}% Regenwahrscheinlichkeit</div>` : `<div class="weather-raceday-note">Rennen liegt außerhalb der 16-Tage-Vorhersage.</div>`}
      </div>
      <div class="weather-strip">${forecastStrip}</div>
      <div class="weather-source">Quelle: Open-Meteo</div>`;
  } catch {
    box.innerHTML = "";
  }
}

function renderNextRace() {
  const nr = DATA.nextRace;
  const box = $("#next-race");
  if (!nr) { box.innerHTML = `<div class="sc-empty">Keine Renndaten verfügbar.</div>`; return; }

  const now = Date.now();
  const sessions = (nr.sessions && nr.sessions.length)
    ? nr.sessions
    : (nr.raceTimestamp ? [{ key: "Rennen", label: "Rennen", timestamp: nr.raceTimestamp }] : []);
  const nextSession = sessions.find((s) => s.timestamp > now) || null;
  const hasStarted = nr.raceTimestamp && now >= nr.raceTimestamp;
  const weekendStart = sessions.length ? sessions[0].timestamp : (nr.raceTimestamp ? nr.raceTimestamp - 2 * 86_400_000 : null);
  const isWeekend = weekendStart && now >= weekendStart && !hasStarted;
  const live = hasStarted || isWeekend;
  const tagLabel = hasStarted ? "Rennen läuft" : isWeekend ? "Rennwochenende" : "Nächstes Rennen";

  const stepsHtml = sessions.length ? `
    <div class="session-steps" id="session-steps">
      ${sessions.map((s) => {
        const passed = s.timestamp <= now;
        const isNext = nextSession && s.timestamp === nextSession.timestamp;
        const time = new Date(s.timestamp).toLocaleString("de-DE", { weekday: "short", hour: "2-digit", minute: "2-digit" });
        return `
          <div class="session-step ${passed ? "is-passed" : ""} ${isNext ? "is-next" : ""}">
            <span class="session-step-dot">${passed ? "✓" : ""}</span>
            <span class="session-step-label">${s.label}</span>
            <span class="session-step-time">${time}</span>
          </div>`;
      }).join("")}
    </div>` : "";

  box.innerHTML = `
    <div class="nr-inner">
      <div class="nr-left">
        <span class="nr-tag ${live ? "is-live" : ""}">${live ? `<span class="live-dot"></span>` : ""}${tagLabel} ${nr.flag ? `<img class="nr-flag" data-fallback src="${nr.flag}" alt="">` : ""}</span>
        <div class="nr-name">${nr.name}</div>
        <div class="nr-circuit">📍 ${nr.circuit}</div>
        <div class="nr-date">🗓️ ${nr.raceText || ""}</div>
        <div class="countdown-label" id="countdown-label"></div>
        <div class="countdown" id="countdown"></div>
        ${stepsHtml}
      </div>
      <div class="nr-right">
        <div class="track-anim-wrap">
          ${trackSvg(nr.geo && nr.geo.track)}
          <div class="track-anim-label">${nr.circuit || nr.country}</div>
        </div>
      </div>
    </div>`;
  bindFallbacks(box);
  startCountdown(sessions);
}

function startCountdown(sessions) {
  clearInterval(countdownTimer);
  const box = $("#countdown");
  const labelBox = $("#countdown-label");
  if (!box || !sessions || !sessions.length) return;
  const paint = () => {
    const now = Date.now();
    const next = sessions.find((s) => s.timestamp > now);

    document.querySelectorAll("#session-steps .session-step").forEach((el, i) => {
      const sess = sessions[i];
      if (!sess) return;
      const passed = sess.timestamp <= now;
      el.classList.toggle("is-passed", passed);
      el.classList.toggle("is-next", !!next && sess.timestamp === next.timestamp);
      const dot = el.querySelector(".session-step-dot");
      if (dot) dot.textContent = passed ? "✓" : "";
    });

    if (!next) {
      if (labelBox) labelBox.textContent = "";
      box.innerHTML = `<span class="cd-live"><span class="live-dot"></span>Rennwochenende beendet – Wertung aktualisiert sich in Kürze</span>`;
      return;
    }
    if (labelBox) labelBox.textContent = `Nächste Session: ${next.label}`;
    const diff = next.timestamp - now;
    const s = Math.floor(diff / 1000);
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    const cell = (v, l) => `<div class="cd-cell"><b>${String(v).padStart(2, "0")}</b><span>${l}</span></div>`;
    box.innerHTML = cell(d, "Tage") + cell(h, "Std") + cell(m, "Min");
  };
  paint();
  countdownTimer = setInterval(paint, COUNTDOWN_MS);
}

/* ---- Fahrerwertung (sortierbar + Suche) ------------------------------- */
function renderDriverTable() {
  const tbody = $("#driver-table tbody");
  const q = $("#driver-search").value.trim().toLowerCase();
  let rows = [...DATA.drivers];

  rows.sort((a, b) => {
    let av, bv;
    if (sortKey === "team") { av = a.teamName; bv = b.teamName; }
    else { av = a[sortKey]; bv = b[sortKey]; }
    if (typeof av === "string") return av.localeCompare(bv) * sortDir;
    return (av - bv) * sortDir;
  });
  if (q) rows = rows.filter((d) =>
    d.display.toLowerCase().includes(q) || d.teamName.toLowerCase().includes(q) || String(d.pos) === q);

  tbody.innerHTML = "";
  const maxPts = Math.max(1, ...DATA.drivers.map((x) => x.points));
  for (const d of rows) {
    const podium = d.pos <= 3 ? `podium-${d.pos}` : "";
    const trophy = d.pos === 1 ? "🥇" : d.pos === 2 ? "🥈" : d.pos === 3 ? "🥉" : "";
    const dl = driverDeltas[d.name];
    const updated = dl && (dl.pos !== 0 || dl.pts !== 0) ? "is-updated" : "";
    const fav = isFavDriver(d) ? "is-favorite" : "";
    const pct = Math.max(2, Math.round((d.points / maxPts) * 100));
    const row = el(`
      <tr class="rank-row ${updated} ${fav}" style="--rc:${d.teamColor}">
        <td class="td-pos ${podium}">
          ${trophy ? `<span class="pos-trophy">${trophy}</span>` : ""}<span class="${podium ? "medal" : ""}">${d.pos}</span>${posDeltaBadge(dl)}
        </td>
        <td>
          <div class="driver-cell">
            <img class="driver-photo" data-fallback data-fallback2="${d.photoFallback || ''}" src="${d.photo || ''}" alt="${d.display}">
            <div class="driver-meta">
              <div class="driver-name">${fav ? `<span class="fav-star" title="Dein Lieblingsfahrer">⭐</span> ` : ""}${d.display}
                ${d.natFlag ? `<img class="nat-flag" data-fallback src="${d.natFlag}" alt="${d.natCode}" title="${d.natCode}">` : ""}
              </div>
              <div class="driver-sub">${d.teamName}</div>
            </div>
          </div>
        </td>
        <td><div class="team-cell"><span class="team-name">${d.teamName}</span></div></td>
        <td class="td-pts">
          <div class="pts-wrap">
            <div class="pts-bar-track"><div class="pts-bar-fill" style="width:${pct}%"></div></div>
            <div class="pts-value">${d.points}${ptsDeltaBadge(dl)}</div>
          </div>
        </td>
      </tr>`);
    tbody.appendChild(row);
  }
  bindFallbacks(tbody);
  document.querySelectorAll("#driver-table th.sortable").forEach((th) =>
    th.classList.toggle("sorted", th.dataset.sort === sortKey));
}

/* ---- Destructors Championship: Community-Schätzungen (Snapshot) --------
   Echte, von der Community geschätzte "Schadenssummen" – Stand & Quelle
   siehe DESTR_SNAPSHOT.asOf. Ist ein statischer Schnappschuss, kein Live-
   Scraping (dafür gibt's keine zuverlässig automatisierbare Quelle). */
const DESTR_SNAPSHOT = {
  asOf: "Stand nach 9 Rennen (5. Juli 2026) · Quelle: mostlyf1.com / Reddit-Community-Schätzungen (u/Dense-Strategy-867)",
  rows: [
    { surname: "albon", total: 1291000, worstGp: "Kanada", worstCost: 881000 },
    { surname: "bearman", total: 1243000, worstGp: "Japan", worstCost: 857000 },
    { surname: "antonelli", total: 1207000, worstGp: "Australien", worstCost: 907000 },
    { surname: "hadjar", total: 1117000, worstGp: "Monaco", worstCost: 619000 },
    { surname: "gasly", total: 1110000, worstGp: "Miami", worstCost: 960000 },
    { surname: "piastri", total: 1001000, worstGp: "Australien", worstCost: 641000 },
    { surname: "leclerc", total: 978000, worstGp: "Monaco", worstCost: 378000 },
    { surname: "verstappen", total: 746000, worstGp: "Australien", worstCost: 350000 },
    { surname: "perez", total: 685000, worstGp: "Australien", worstCost: 210000 },
    { surname: "colapinto", total: 496000, worstGp: "Monaco", worstCost: 236000 },
    { surname: "ocon", total: 470000, worstGp: "China", worstCost: 260000 },
    { surname: "russell", total: 450000, worstGp: "Australien", worstCost: 150000 },
    { surname: "alonso", total: 425000, worstGp: "Kanada", worstCost: 275000 },
    { surname: "hamilton", total: 310000, worstGp: "Miami", worstCost: 310000 },
    { surname: "stroll", total: 275000, worstGp: "Monaco", worstCost: 275000 },
    { surname: "sainz", total: 250000, worstGp: "Australien", worstCost: 150000 },
    { surname: "bortoleto", total: 225000, worstGp: "Monaco", worstCost: 125000 },
    { surname: "hulkenberg", total: 150000, worstGp: "Miami", worstCost: 150000 },
    { surname: "norris", total: 150000, worstGp: "Australien", worstCost: 150000 },
    { surname: "lawson", total: 125000, worstGp: "Miami", worstCost: 125000 },
  ],
};
const fmtUSD = (n) => "$" + n.toLocaleString("de-DE");

function renderDestructors() {
  const box = $("#destr-list");
  const noteEl = $("#destr-asof");
  if (!box) return;
  if (noteEl) noteEl.textContent = DESTR_SNAPSHOT.asOf;
  const rows = DESTR_SNAPSHOT.rows.map((r) => {
    const d = findDriverByShort(r.surname) || {};
    return { ...r, display: d.display || r.surname, photo: d.photo || "", photoFallback: d.photoFallback || "", teamColor: d.teamColor || "#888", teamName: d.teamName || "" };
  });
  const maxCost = Math.max(...rows.map((r) => r.total));
  box.innerHTML = rows.map((d, i) => {
    const pct = Math.max(6, Math.round((d.total / maxCost) * 100));
    return `
      <div class="destr-row" style="--rc:${d.teamColor}">
        <div class="destr-rank">#${i + 1}</div>
        <img class="destr-photo" data-fallback data-fallback2="${d.photoFallback || ''}" src="${d.photo}" alt="${d.display}">
        <div class="destr-meta">
          <div class="destr-name">${d.display} <span class="destr-team">${d.teamName}</span></div>
          <div class="destr-bar-track"><div class="destr-bar-fill" style="width:${pct}%"></div></div>
          <div class="destr-badges">
            <span class="destr-badge">💥 Teuerstes Rennen: ${d.worstGp} (${fmtUSD(d.worstCost)})</span>
          </div>
        </div>
        <div class="destr-count">${fmtUSD(d.total)}</div>
      </div>`;
  }).join("");
  bindFallbacks(box);
}

/* ---- Konstrukteure ---------------------------------------------------- */
function renderChampBars() {
  const box = $("#champ-bars");
  if (!DATA || !box) return;
  const progressTeams = (PROGRESS && PROGRESS.teams) || [];
  const byId = {};
  progressTeams.forEach((t) => { byId[t.id] = t; });
  const maxPts = Math.max(1, ...DATA.teams.map((t) => t.points));
  box.innerHTML = DATA.teams.map((t) => {
    const extra = byId[t.id] || { wins: 0, podiums: 0 };
    const pct = Math.max(2, Math.round((t.points / maxPts) * 100));
    return `
      <div class="champ-row" style="--rc:${t.color}">
        <img class="champ-logo" data-fallback src="${proxyImg(t.logo || "")}" alt="${t.name}">
        <div class="champ-meta">
          <div class="champ-name">${t.name}</div>
          <div class="champ-bar-track"><div class="champ-bar-fill" style="width:${pct}%"></div></div>
        </div>
        <div class="champ-stats">
          <span class="champ-pts">${t.points} Pkt.</span>
          <span class="champ-badge">🏆 ${extra.wins}</span>
          <span class="champ-badge">🏅 ${extra.podiums}</span>
        </div>
      </div>`;
  }).join("");
  bindFallbacks(box);
}

function renderTeamTable() {
  const tbody = $("#team-table tbody");
  const q = $("#team-search").value.trim().toLowerCase();
  let rows = DATA.teams.filter((t) => !q || t.name.toLowerCase().includes(q));
  tbody.innerHTML = "";
  const maxPts = Math.max(1, ...DATA.teams.map((x) => x.points));
  for (const t of rows) {
    const logo = t.logo || t.car || "";
    const podium = t.pos <= 3 ? `podium-${t.pos}` : "";
    const trophy = t.pos === 1 ? "🥇" : t.pos === 2 ? "🥈" : t.pos === 3 ? "🥉" : "";
    const dl = teamDeltas[t.id];
    const updated = dl && (dl.pos !== 0 || dl.pts !== 0) ? "is-updated" : "";
    const pct = Math.max(2, Math.round((t.points / maxPts) * 100));
    const row = el(`
      <tr class="rank-row ${updated}" style="--rc:${t.color}">
        <td class="td-pos ${podium}">
          ${trophy ? `<span class="pos-trophy">${trophy}</span>` : ""}<span class="${podium ? "medal" : ""}">${t.pos}</span>${posDeltaBadge(dl)}
        </td>
        <td>
          <div class="team-cell">
            <img class="team-logo-sm" data-fallback src="${proxyImg(logo)}" alt="${t.name}">
            <span>${t.name}</span>
          </div>
        </td>
        <td class="td-pts">
          <div class="pts-wrap">
            <div class="pts-bar-track"><div class="pts-bar-fill" style="width:${pct}%"></div></div>
            <div class="pts-value">${t.points}${ptsDeltaBadge(dl)}</div>
          </div>
        </td>
      </tr>`);
    tbody.appendChild(row);
  }
  bindFallbacks(tbody);
}

/* ---- Events ----------------------------------------------------------- */
function wire() {
  initNav();
  $("#driver-search").addEventListener("input", renderDriverTable);
  $("#team-search").addEventListener("input", renderTeamTable);
  $("#drivers-grid-search").addEventListener("input", renderDriversGrid);
  $("#teams-grid-search").addEventListener("input", renderTeamsGrid);
  $("#refresh-btn").addEventListener("click", () => load());

  document.querySelectorAll("#driver-table th.sortable").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      if (sortKey === key) sortDir *= -1; else { sortKey = key; sortDir = key === "points" ? -1 : 1; }
      renderDriverTable();
    });
  });

  $("#fav-driver").addEventListener("change", (e) => {
    localStorage.setItem("fav.driver", e.target.value);
    renderDriverShowcase();
    renderDriverTable();
    renderDriversGrid();
    renderNewsHighlight();
  });
  $("#fav-team").addEventListener("change", (e) => {
    localStorage.setItem("fav.team", e.target.value); renderTeamShowcase();
  });

  $("#stats-driver").addEventListener("change", (e) => { localStorage.setItem("stats.driver", e.target.value); renderDriverStats(); });

  $("#compare-a").addEventListener("change", (e) => { localStorage.setItem("compare.a", e.target.value); renderCompare(); });
  $("#compare-b").addEventListener("change", (e) => { localStorage.setItem("compare.b", e.target.value); renderCompare(); });

  $("#race-modal-close").addEventListener("click", closeRaceModal);
  $("#race-modal-backdrop").addEventListener("click", closeRaceModal);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeRaceModal();
  });
}

/* ---- News --------------------------------------------------------------- */
let NEWS_ITEMS = []; // zuletzt geladene News (fürs Neu-Rendern bei Lieblingsfahrer-Wechsel ohne Refetch)

function favDriverSurname() {
  const favName = getFavDriverName();
  if (!favName || !DATA) return "";
  const d = DATA.drivers.find((x) => x.name === favName);
  return d ? normalizeName(d.display.split(" ").slice(-1)[0]) : "";
}

function renderNewsHighlight() {
  const box = $("#news-list");
  if (!box || !NEWS_ITEMS.length) return;

  let known = [];
  try { known = JSON.parse(localStorage.getItem("news.seen") || "[]"); } catch { known = []; }
  const knownSet = new Set(known);
  const isFirstLoad = known.length === 0;
  const surname = favDriverSurname();

  const decorated = NEWS_ITEMS.map((n) => ({ ...n, isFav: surname && normalizeName(n.title).includes(surname) }));
  decorated.sort((a, b) => (b.isFav ? 1 : 0) - (a.isFav ? 1 : 0));

  box.innerHTML = decorated.map((n) => `
    <a class="news-card ${n.isFav ? "is-fav-news" : ""}" href="${n.url}" target="_blank" rel="noopener">
      <img class="news-thumb" data-fallback src="${n.image}" alt="">
      <div class="news-body">
        <div class="news-title">
          ${n.isFav ? `<span class="fav-star" title="Dein Lieblingsfahrer">⭐</span> ` : ""}
          ${!isFirstLoad && !knownSet.has(n.url) ? `<span class="news-new">NEU</span> ` : ""}${n.title}
        </div>
        ${n.time ? `<div class="news-time">${n.time}</div>` : ""}
      </div>
      <span class="news-arrow">↗</span>
    </a>`).join("");
  bindFallbacks(box);
}

async function loadNews() {
  const box = $("#news-list");
  if (!box) return;
  try {
    const res = await fetch("/api/news", { cache: "no-store" });
    if (!res.ok) throw new Error("Serverfehler " + res.status);
    const data = await res.json();
    const items = data.items || [];
    if (!items.length) { box.innerHTML = `<div class="sc-empty">Keine News gefunden.</div>`; return; }

    NEWS_ITEMS = items;
    renderNewsHighlight();

    try { localStorage.setItem("news.seen", JSON.stringify(items.map((n) => n.url).slice(0, 150))); } catch { /* ignorieren */ }
  } catch (err) {
    box.innerHTML = `<div class="sc-empty">News konnten nicht geladen werden.<br><small>${err.message}</small></div>`;
  }
}

/* ---- Start ------------------------------------------------------------ */
wire();
load(true);
loadNews();
loadTrackShapes().then(() => { if (DATA) renderNextRace(); });
setInterval(() => load(false), REFRESH_MS);
setInterval(loadNews, REFRESH_MS);
