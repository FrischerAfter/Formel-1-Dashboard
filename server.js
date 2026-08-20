#!/usr/bin/env node
/**
 * F1 Live Dashboard – Backend / Scraper (Node.js-Version)
 * ========================================================
 * Portiert von server.py. Nutzt nur Node-Bordmittel (kein Express nötig).
 *
 * WARUM EIN SERVER?
 * Ein Browser darf aus Sicherheitsgründen (CORS) fremde Webseiten wie
 * motorsport-total.com nicht per fetch() auslesen. Dieser Server holt die
 * Seiten SERVERSEITIG (kein CORS), liest Tabellen + Bild-URLs live aus und
 * liefert dem Frontend sauberes JSON unter /api/data. Die BILDER selbst lädt
 * der Browser danach direkt von motorsport-total.com.
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
let sharp;
try { sharp = require('sharp'); } catch { sharp = null; } // Bildveredelung (Freistellen/Zuschneiden), optional

const BASE = 'https://www.motorsport-total.com';
const YEAR = 2026;
const PORT = Number.isFinite(Number.parseInt(process.env.PORT, 10))
  ? Number.parseInt(process.env.PORT, 10)
  : 8712;
const CACHE_TTL_MS = 300_000; // 5 Minuten
const HERE = __dirname;

// Lokale Bilder bleiben bevorzugt. Fehlt ein Asset im GitHub-Repository,
// wird automatisch die vorhandene externe Fallback-Quelle verwendet.
function existingLocalAsset(relativePath) {
  if (!relativePath) return null;
  const relative = String(relativePath).replace(/^\/+/, '');
  const target = path.resolve(HERE, relative);
  if (target !== HERE && target.startsWith(HERE + path.sep) && fs.existsSync(target)) {
    return relativePath;
  }
  return null;
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120 Safari/537.36';

// ---------------------------------------------------------------------------
//  Referenz-Metadaten (Darstellung / Flaggen) – keine Wertungsdaten
// ---------------------------------------------------------------------------
const TEAM_META = {
  mclaren: { name: 'McLaren', color: '#FF8000' },
  mercedes: { name: 'Mercedes-AMG', color: '#27F4D2' },
  redbull: { name: 'Red Bull', color: '#3671C6' },
  ferrari: { name: 'Ferrari', color: '#E8002D' },
  williams: { name: 'Williams', color: '#1868DB' },
  racingbulls: { name: 'Racing Bulls', color: '#6C98FF' },
  aston: { name: 'Aston Martin', color: '#229971' },
  haas: { name: 'Haas', color: '#B6BABD' },
  alpine: { name: 'Alpine', color: '#0093CC' },
  audi: { name: 'Audi', color: '#F50537' },
  cadillac: { name: 'Cadillac', color: '#C79A3B' },
};

// Motorenhersteller je Team, Saison 2026 (Referenzdaten, ändern sich nur
// zwischen Saisons). Quelle: offizielle Motorenreglement-Zuordnung 2026.
const ENGINE_SUPPLIER = {
  mclaren: 'Mercedes', mercedes: 'Mercedes', williams: 'Mercedes', alpine: 'Mercedes',
  ferrari: 'Ferrari', haas: 'Ferrari', cadillac: 'Ferrari',
  redbull: 'Red Bull Ford', racingbulls: 'Red Bull Ford',
  aston: 'Honda', audi: 'Audi',
};

// Chassisname + Auto-Bild je Team, Saison 2026. Bilder werden direkt von
// formula1dashboard.com eingebunden (auf Wunsch als Quelle für die Teams-Seite).
const CHASSIS_NAME = {
  mercedes: 'W17', ferrari: 'SF-26', mclaren: 'MCL40', redbull: 'RB22',
  alpine: 'A526', racingbulls: 'VCARB 03', haas: 'VF-26', williams: 'FW48',
  audi: 'R26', aston: 'AMR26', cadillac: 'MAC-26',
};
// Lokal hochgeladene Autobilder überschreiben das von formula1dashboard.com
// verlinkte Bild für dieses Team (auf Wunsch: Original-Bilder statt CDN-Link).
const CAR_IMAGE_OVERRIDES = {
  mercedes: existingLocalAsset('/assets/cars/mercedes.png'),
  ferrari: existingLocalAsset('/assets/cars/ferrari.png'),
  mclaren: existingLocalAsset('/assets/cars/mclaren.png'),
  redbull: existingLocalAsset('/assets/cars/redbull.png'),
  alpine: existingLocalAsset('/assets/cars/alpine.png'),
  racingbulls: existingLocalAsset('/assets/cars/racingbulls.png'),
  haas: existingLocalAsset('/assets/cars/haas.png'),
  williams: existingLocalAsset('/assets/cars/williams.png'),
  audi: existingLocalAsset('/assets/cars/audi.png'),
  aston: existingLocalAsset('/assets/cars/aston.png'),
  cadillac: existingLocalAsset('/assets/cars/cadillac.png'),
};
// Lokal hochgeladene Fahrerfotos überschreiben das von formula1dashboard.com
// verlinkte Portrait für diesen Fahrer (Schlüssel = Nachname, normalisiert).
// Fehlt ein Fahrer hier, wird automatisch die CDN-Version genutzt.
const DRIVER_PHOTO_OVERRIDES = {
  albon: existingLocalAsset('/assets/drivers/albon.png'),
  alonso: existingLocalAsset('/assets/drivers/alonso.png'),
  antonelli: existingLocalAsset('/assets/drivers/antonelli.png'),
  bearman: existingLocalAsset('/assets/drivers/bearman.png'),
  bortoleto: existingLocalAsset('/assets/drivers/bortoleto.png'),
  bottas: existingLocalAsset('/assets/drivers/bottas.png'),
  colapinto: existingLocalAsset('/assets/drivers/colapinto.png'),
  gasly: existingLocalAsset('/assets/drivers/gasly.png'),
  hadjar: existingLocalAsset('/assets/drivers/hadjar.png'),
  hamilton: existingLocalAsset('/assets/drivers/hamilton.png'),
  hulkenberg: existingLocalAsset('/assets/drivers/hulkenberg.png'),
  lawson: existingLocalAsset('/assets/drivers/lawson.png'),
  leclerc: existingLocalAsset('/assets/drivers/leclerc.png'),
  lindblad: existingLocalAsset('/assets/drivers/lindblad.png'),
  norris: existingLocalAsset('/assets/drivers/norris.png'),
  ocon: existingLocalAsset('/assets/drivers/ocon.png'),
  perez: existingLocalAsset('/assets/drivers/perez.png'),
  piastri: existingLocalAsset('/assets/drivers/piastri.png'),
  russell: existingLocalAsset('/assets/drivers/russell.png'),
  sainz: existingLocalAsset('/assets/drivers/sainz.png'),
  stroll: existingLocalAsset('/assets/drivers/stroll.png'),
  verstappen: existingLocalAsset('/assets/drivers/verstappen.png'),
};

const CAR_IMAGE_2026 = {
  mercedes: 'https://cdn.formula1dashboard.com/cars/2026/mercedes-w17-2026-f1-car-formula-1-dashboard.png',
  ferrari: 'https://cdn.formula1dashboard.com/cars/2026/ferrari-sf26-2026-f1-car-formula-1-dashboard.png',
  mclaren: 'https://cdn.formula1dashboard.com/cars/2026/mclaren-mcl40-2026-f1-car-formula-1-dashboard.png',
  redbull: 'https://cdn.formula1dashboard.com/cars/2026/redbull-racing-rb22-2026-f1-car-formula-1-dashboard.png',
  alpine: 'https://cdn.formula1dashboard.com/cars/2026/alpine-a526-2026-f1-car-formula-1-dashboard.png',
  racingbulls: 'https://cdn.formula1dashboard.com/cars/2026/racing-bulls-vcarb03-2026-f1-car-formula-1-dashboard.png',
  haas: 'https://cdn.formula1dashboard.com/cars/2026/haas-vf26-2026-f1-car-formula-1-dashboard.png',
  williams: 'https://cdn.formula1dashboard.com/cars/2026/williams-fw48-2026-f1-car-formula-1-dashboard.png',
  audi: 'https://cdn.formula1dashboard.com/cars/2026/audi-r26-2026-f1-car-formula-1-dashboard.png',
  aston: 'https://cdn.formula1dashboard.com/cars/2026/aston-martin-amr26-2026-f1-car-formula-1-dashboard.png',
  cadillac: 'https://cdn.formula1dashboard.com/cars/2026/cadillac-mac-26-2026-f1-car-formula-1-dashboard.png',
};

const LOGO_TO_ID = {
  mclaren: 'mclaren', mercedes: 'mercedes', redbull: 'redbull',
  ferrari: 'ferrari', williams: 'williams', rb: 'racingbulls',
  astonmartin: 'aston', haas: 'haas', alpine: 'alpine',
  audi: 'audi', cadillac: 'cadillac',
};

const DRIVER_NAT = {
  antonelli: 'ITA', russell: 'GBR', hamilton: 'GBR', leclerc: 'MON',
  norris: 'GBR', piastri: 'AUS', verstappen: 'NED', hadjar: 'FRA',
  gasly: 'FRA', lawson: 'NZL', lindblad: 'GBR', bearman: 'GBR',
  colapinto: 'ARG', bortoleto: 'BRA', sainz: 'ESP', albon: 'THA',
  ocon: 'FRA', alonso: 'ESP', hulkenberg: 'GER', bottas: 'FIN',
  perez: 'MEX', stroll: 'CAN',
};
// Die kurzen Codes oben sind IOC-/Motorsport-übliche 3-Buchstaben-Codes (gut
// lesbar als Text). Für die Flaggenbilder brauchen wir den ISO-3166-1-alpha-2-
// Code, den flagcdn.com erwartet.
const IOC3_TO_ISO2 = {
  ITA: 'it', GBR: 'gb', MON: 'mc', AUS: 'au', NED: 'nl', FRA: 'fr', NZL: 'nz',
  ARG: 'ar', BRA: 'br', ESP: 'es', THA: 'th', GER: 'de', FIN: 'fi', MEX: 'mx', CAN: 'ca',
};

// Land -> ISO-3166-1-alpha-2-Code für die Flaggenbilder der Rennen.
const COUNTRY_ISO2 = {
  belgien: 'be', ungarn: 'hu', niederlande: 'nl', italien: 'it',
  spanien: 'es', aserbaidschan: 'az', singapur: 'sg', usa: 'us',
  mexiko: 'mx', brasilien: 'br', katar: 'qa', abudhabi: 'ae',
  grossbritannien: 'gb', grossbritanien: 'gb', japan: 'jp',
  australien: 'au', china: 'cn', kanada: 'ca', monaco: 'mc',
  oesterreich: 'at', osterreich: 'at', bahrain: 'bh', saudiarabien: 'sa', miami: 'us',
  // Städte-/Strecken-Namen, die motorsport-total teils statt des Landes als
  // GP-Namen verwendet (z.B. "Großer Preis von Las Vegas" ohne "USA" davor) -
  // damit die Flagge trotzdem gefunden wird. Schlüssel sind hier absichtlich
  // ohne Leerzeichen/Bindestrich, weil normalize() diese immer entfernt.
  lasvegas: 'us', austin: 'us', cota: 'us', mexicocity: 'mx',
  barcelona: 'es', katalonien: 'es', madrid: 'es', madring: 'es',
  imola: 'it', monza: 'it', emiliaromagna: 'it',
  melbourne: 'au', suzuka: 'jp', shanghai: 'cn', sakhir: 'bh',
  silverstone: 'gb', spa: 'be', spafrancorchamps: 'be',
  budapest: 'hu', hungaroring: 'hu', zandvoort: 'nl', baku: 'az',
  mexikostadt: 'mx', mexicostadt: 'mx',
  interlagos: 'br', saopaulo: 'br',
  losail: 'qa', lusail: 'qa', jeddah: 'sa', dschidda: 'sa',
  yasmarina: 'ae', spielberg: 'at', redbullring: 'at',
  montreal: 'ca',
};

// Rechteckige Länderflaggen statt der runden "Pin"-Icons von motorsport-total
// (auf Wunsch: gleiche Quelle, die welt-flaggen.de selbst für die Einbindung
// in Websites/Apps empfiehlt -> flagcdn.com, kostenlos, kein Key nötig).
const flagUrl = (iso2) => (iso2 ? `https://flagcdn.com/h60/${iso2.toLowerCase()}.png` : null);

// Robuste Flaggen-Zuordnung: erst den extrahierten Ländernamen probieren,
// bei Fehlschlag den KOMPLETTEN Renn-Namen nach jedem bekannten Land-/Stadt-
// Schlüssel absuchen (deckt ungewöhnliche Namensformate ab, z.B. wenn der
// Ländername nicht sauber vom Rest getrennt werden konnte).
const COUNTRY_ISO2_KEYS_BY_LENGTH = Object.keys(COUNTRY_ISO2).sort((a, b) => b.length - a.length);
function resolveFlag(rawCountry, fullName) {
  let iso2 = COUNTRY_ISO2[normalize(rawCountry)] || null;
  if (!iso2 && fullName) {
    const hay = normalize(fullName);
    for (const k of COUNTRY_ISO2_KEYS_BY_LENGTH) {
      if (hay.includes(k)) { iso2 = COUNTRY_ISO2[k]; break; }
    }
  }
  return flagUrl(iso2);
}

// Eigene, offizielle Team-Logos (lokal in /assets) – überschreiben das von
// motorsport-total.com gescrapte Logo für diese Teams, damit das
// Erscheinungsbild einheitlich und markenkonform bleibt.
const LOGO_OVERRIDES = {
  mercedes: existingLocalAsset('/assets/logos/mercedes.png'),
  williams: existingLocalAsset('/assets/logos/williams.png'),
  alpine: existingLocalAsset('/assets/logos/alpine.png'),
  aston: existingLocalAsset('/assets/logos/aston.png'),
  audi: existingLocalAsset('/assets/logos/audi.png'),
  cadillac: existingLocalAsset('/assets/logos/cadillac.png'),
  ferrari: existingLocalAsset('/assets/logos/ferrari.png'),
  haas: existingLocalAsset('/assets/logos/haas.png'),
  mclaren: existingLocalAsset('/assets/logos/mclaren.png'),
  racingbulls: existingLocalAsset('/assets/logos/racingbulls.png'),
  redbull: existingLocalAsset('/assets/logos/redbull.png'),
};

// ---------------------------------------------------------------------------
//  HTTP-Hilfen
// ---------------------------------------------------------------------------
async function fetchPage(url, timeoutMs = 25_000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA },
      signal: controller.signal,
    });
    const buf = await res.arrayBuffer();
    // motorsport-total liefert cp1252 (= windows-1252)
    return new TextDecoder('windows-1252').decode(buf);
  } finally {
    clearTimeout(t);
  }
}

function fixMojibake(s) {
  // Manche Namen sind als UTF-8 in eine Latin-1-Seite eingebettet ('ü' -> 'Ã¼').
  if (/[ÃÂâ]/.test(s)) {
    try {
      const bytes = Uint8Array.from([...s].map((c) => c.charCodeAt(0)));
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      return s;
    }
  }
  return s;
}

function normalize(s) {
  // Kleinbuchstaben ohne Umlaute/Akzente, nur a-z – für Namensabgleich.
  let out = s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  out = out.replace(/ß/g, 'ss');
  return out.toLowerCase().replace(/[^a-z]/g, '');
}

function basename(url) {
  const trimmed = url.replace(/\/+$/, '');
  const parts = trimmed.split('/');
  return parts[parts.length - 1];
}

/**
 * Generische Tabellen-Extraktion (unabhängig von CSS-Klassen): findet alle
 * <table>-Blöcke und zerlegt sie in Zeilen/Zellen mit Text + optionalem Link
 * + optionalem Bild. Wird für die Renn-/Saisonergebnisse verwendet, deren
 * Markup deutlich einfacher/stabiler ist als die Wertungs-/Team-Seiten.
 */
function findTables(html) {
  const out = [];
  const re = /<table[^>]*>([\s\S]*?)<\/table>/g;
  let m;
  while ((m = re.exec(html)) !== null) out.push(m[1]);
  return out;
}
function tableAfterHeading(html, heading) {
  const idx = html.indexOf(heading);
  if (idx === -1) return null;
  const rest = html.slice(idx);
  const m = rest.match(/<table[^>]*>([\s\S]*?)<\/table>/);
  return m ? m[1] : null;
}
function parseTableRows(tableInner) {
  const rows = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let trMatch;
  while ((trMatch = trRe.exec(tableInner)) !== null) {
    const cells = [];
    const tdRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g;
    let tdMatch;
    while ((tdMatch = tdRe.exec(trMatch[1])) !== null) {
      const cellHtml = tdMatch[1];
      const hrefM = cellHtml.match(/href="([^"]+)"/);
      const imgM = cellHtml.match(/src="([^"]+)"/);
      const text = fixMojibake(cellHtml
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim());
      cells.push({ text, href: hrefM ? hrefM[1] : null, img: imgM ? imgM[1] : null });
    }
    if (cells.length) rows.push(cells);
  }
  return rows;
}

// ---------------------------------------------------------------------------
//  Parser
// ---------------------------------------------------------------------------
function parseDriverStandings(html) {
  const result = new Map();
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let rowMatch;
  while ((rowMatch = rowRe.exec(html)) !== null) {
    const row = rowMatch[1];
    if (!row.includes('red-font underline-hover')) continue;
    const mPos = row.match(/class="result[^"]*"[^>]*>\s*(\d+)\./);
    const mName = row.match(/title="([^"]+)"[^>]*class="red-font underline-hover"/);
    const mPts = row.match(/font-bold">\s*(\d+)\s*</);
    if (mPos && mName && mPts) {
      const pos = parseInt(mPos[1], 10);
      if (!result.has(pos)) {
        result.set(pos, [fixMojibake(mName[1].trim()), parseInt(mPts[1], 10)]);
      }
    }
  }
  return [...result.keys()].sort((a, b) => a - b).map((pos) => {
    const [name, pts] = result.get(pos);
    return { pos, name, pts };
  });
}

function parseTeams(html) {
  const tokens = [];
  const imgRe = /<img[^>]+src="([^"]+)"/g;
  let m;
  while ((m = imgRe.exec(html)) !== null) {
    const src = m[1];
    const low = src.toLowerCase();
    if (low.includes('/logos/')) tokens.push(['LOGO', src]);
    else if (low.includes('/team-logos/')) tokens.push(['CAR', src]);
    else if (low.includes('/fahrer/')) tokens.push(['PHOTO', src]);
  }

  const blocks = [];
  let cur = null;
  for (const [typ, src] of tokens) {
    if (typ === 'CAR') {
      if (cur) blocks.push(cur);
      cur = { car: src, logo: null, photos: [] };
    } else if (typ === 'LOGO' && cur && cur.logo === null) {
      cur.logo = src;
    } else if (typ === 'PHOTO' && cur) {
      cur.photos.push(src);
    }
  }
  if (cur) blocks.push(cur);

  const teams = {};
  const code2team = {};
  const team2codes = {};
  for (const b of blocks) {
    let tid;
    if (b.logo) {
      tid = LOGO_TO_ID[basename(b.logo).split('.')[0]];
    } else {
      const car = basename(b.car).toLowerCase();
      tid = car.startsWith('audi') ? 'audi' : car.startsWith('cadillac') ? 'cadillac' : car.split('-')[0];
    }
    if (!tid) continue;
    teams[tid] = { logo: b.logo, car: b.car, photos: {} };
    team2codes[tid] = [];
    for (const p of b.photos) {
      const code = basename(p).split('.')[0];
      code2team[code] = tid;
      team2codes[tid].push(code);
      teams[tid].photos[code] = p;
    }
  }
  return { teams, code2team, team2codes };
}

function matchCode(fullName, codes) {
  const toks = fullName.split(/\s+/).map(normalize).filter(Boolean);
  if (toks.length === 0) return null;
  const init = toks[0].slice(0, 1);
  // 1) Initiale passt + Nachnamen-Teil ist genau ein Namensbestandteil
  for (const c of codes) {
    if (c[0] === init && toks.slice(1).includes(c.slice(1))) return c;
  }
  // 2) Nachnamen-Teil ist irgendein Namensbestandteil (Initiale egal)
  for (const c of codes) {
    if (toks.includes(c.slice(1))) return c;
  }
  // 3) Nachnamen-Teil kommt im zusammengezogenen Namen vor
  const joined = toks.join('');
  for (const c of codes) {
    if (c.length > 3 && joined.includes(c.slice(1))) return c;
  }
  return null;
}

// Motorsport-total liefert den Ländernamen aus einem JS-Widget teils ohne
// Umlaute/verkürzt (z.B. "Grossbritannien" statt "Großbritannien"). Diese
// Tabelle stellt die korrekte deutsche Schreibweise für die Anzeige wieder
// her, ohne die (unabhängig funktionierende) Flaggen-/Geo-Zuordnung zu berühren.
const NICE_COUNTRY_NAME = {
  oesterreich: 'Österreich',
  osterreich: 'Österreich',
  grossbritannien: 'Großbritannien',
  grossbritanien: 'Großbritannien',
  vereinigtekoenigreich: 'Großbritannien',
  usa: 'USA',
  vereinigtestaaten: 'USA',
  vae: 'Abu Dhabi',
  abudhabi: 'Abu Dhabi',
  saudiarabien: 'Saudi-Arabien',
  // Städte-/Strecken-Namen -> korrekter Landesname, falls motorsport-total
  // statt des Landes nur die Stadt/Strecke im Namen führt.
  spielberg: 'Österreich', redbullring: 'Österreich',
  silverstone: 'Großbritannien',
  lasvegas: 'USA', austin: 'USA', cota: 'USA', miami: 'USA',
  barcelona: 'Spanien', katalonien: 'Spanien', madrid: 'Spanien', madring: 'Spanien',
  imola: 'Italien', monza: 'Italien', emiliaromagna: 'Italien',
  melbourne: 'Australien', suzuka: 'Japan', shanghai: 'China', sakhir: 'Bahrain',
  spa: 'Belgien', spafrancorchamps: 'Belgien',
  budapest: 'Ungarn', hungaroring: 'Ungarn', zandvoort: 'Niederlande', baku: 'Aserbaidschan',
  mexikostadt: 'Mexiko', mexicostadt: 'Mexiko', interlagos: 'Brasilien', saopaulo: 'Brasilien',
  losail: 'Katar', lusail: 'Katar', jeddah: 'Saudi-Arabien', dschidda: 'Saudi-Arabien',
  yasmarina: 'Abu Dhabi', montreal: 'Kanada',
};
const NICE_COUNTRY_KEYS_BY_LENGTH = Object.keys(NICE_COUNTRY_NAME).sort((a, b) => b.length - a.length);

// Robuste Namens-Auflösung, analog zu resolveFlag(): erst den extrahierten
// Ländernamen exakt probieren, sonst den kompletten Renn-Namen nach jedem
// bekannten Land-/Stadt-Schlüssel absuchen.
function resolveCountryName(rawCountry, fullName) {
  let nice = NICE_COUNTRY_NAME[normalize(rawCountry)] || null;
  if (!nice && fullName) {
    const hay = normalize(fullName);
    for (const k of NICE_COUNTRY_KEYS_BY_LENGTH) {
      if (hay.includes(k)) { nice = NICE_COUNTRY_NAME[k]; break; }
    }
  }
  return nice || rawCountry;
}

// Grobe Koordinaten der Rennstrecken (statische Referenzdaten für die Karte,
// ändern sich praktisch nie) – Zuordnung per Schlüsselwort-Suche im Slug/Land,
// damit kleine Abweichungen im gescrapten Slug nicht sofort zum Ausfall führen.
const CIRCUIT_GEO = [
  { match: ['sakhir', 'bahrain'], lat: 26.0325, lng: 50.5106, city: 'Sakhir', track: 'bh-2002' },
  { match: ['dschidda', 'jeddah'], lat: 21.6319, lng: 39.1044, city: 'Jeddah', track: 'sa-2021' },
  { match: ['melbourne', 'albertpark'], lat: -37.8497, lng: 144.968, city: 'Melbourne', track: 'au-1953' },
  { match: ['suzuka'], lat: 34.8431, lng: 136.541, city: 'Suzuka', track: 'jp-1962' },
  { match: ['shanghai', 'schanghai'], lat: 31.3389, lng: 121.2198, city: 'Shanghai', track: 'cn-2004' },
  { match: ['miami'], lat: 25.9581, lng: -80.2389, city: 'Miami', track: 'us-2022' },
  { match: ['imola'], lat: 44.3439, lng: 11.7167, city: 'Imola', track: 'it-1953' },
  { match: ['monaco', 'montecarlo'], lat: 43.7347, lng: 7.4206, city: 'Monaco', track: 'mc-1929' },
  { match: ['madrid', 'madring'], lat: 40.42, lng: -3.43, city: 'Madrid', track: 'es-2026' },
  { match: ['barcelona', 'catalunya'], lat: 41.57, lng: 2.2611, city: 'Barcelona', track: 'es-1991' },
  { match: ['montreal', 'villeneuve'], lat: 45.5, lng: -73.5228, city: 'Montreal', track: 'ca-1978' },
  { match: ['spielberg', 'redbullring', 'oesterreich', 'osterreich'], lat: 47.2197, lng: 14.7647, city: 'Spielberg', track: 'at-1969' },
  { match: ['silverstone'], lat: 52.0786, lng: -1.0169, city: 'Silverstone', track: 'gb-1948' },
  { match: ['spa'], lat: 50.4372, lng: 5.9714, city: 'Spa-Francorchamps', track: 'be-1925' },
  { match: ['hungaroring', 'budapest'], lat: 47.5789, lng: 19.2486, city: 'Budapest', track: 'hu-1986' },
  { match: ['zandvoort'], lat: 52.3888, lng: 4.5409, city: 'Zandvoort', track: 'nl-1948' },
  { match: ['monza'], lat: 45.6156, lng: 9.2811, city: 'Monza', track: 'it-1922' },
  { match: ['baku'], lat: 40.3725, lng: 49.8533, city: 'Baku', track: 'az-2016' },
  { match: ['singapur', 'marinabay', 'singapore'], lat: 1.2914, lng: 103.864, city: 'Singapur', track: 'sg-2008' },
  { match: ['austin', 'cota'], lat: 30.1328, lng: -97.6411, city: 'Austin', track: 'us-2012' },
  { match: ['mexiko', 'mexico'], lat: 19.4042, lng: -99.0907, city: 'Mexiko-Stadt', track: 'mx-1962' },
  { match: ['interlagos', 'saopaulo'], lat: -23.7036, lng: -46.6997, city: 'São Paulo', track: 'br-1940' },
  { match: ['lasvegas'], lat: 36.1147, lng: -115.1728, city: 'Las Vegas', track: 'us-2023' },
  { match: ['losail', 'katar', 'qatar'], lat: 25.49, lng: 51.4542, city: 'Lusail', track: 'qa-2004' },
  { match: ['abudhabi', 'yasmarina'], lat: 24.4672, lng: 54.6031, city: 'Abu Dhabi', track: 'ae-2009' },
];
function findCircuitGeo(slug, country) {
  const hay = normalize(`${slug || ''} ${country || ''}`);
  return CIRCUIT_GEO.find((c) => c.match.some((m) => hay.includes(normalize(m)))) || null;
}

async function parseNextRace(calHtml) {
  const m = calHtml.match(/countdown_f1\s*=\s*(\{[\s\S]*?\})\s*;/);
  let cd = {};
  if (m) {
    try {
      cd = JSON.parse(m[1]);
    } catch {
      cd = {};
    }
  }
  const event = fixMojibake((cd.event || '').replace('-GP', '').trim()) || 'Formel 1';
  const sessionStart = cd.start;

  let slug = null;
  for (const link of cd.links || []) {
    const mm = (link.href || '').match(/\/rennstrecken\/([^/]+)\//);
    if (mm) {
      slug = mm[1];
      break;
    }
  }

  const circuit = slug
    ? slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    : '';
  const rawCountry = event;
  const country = resolveCountryName(rawCountry, `${rawCountry} ${circuit}`);
  const flag = resolveFlag(rawCountry, `${rawCountry} ${circuit}`);

  let raceTsMs = null;
  let raceText = cd.time || '';
  if (sessionStart) {
    const localMs = (sessionStart + 2 * 3600) * 1000; // CEST-Offset wie im Original
    const local = new Date(localMs);
    const raceLocal = new Date(local.getTime() + 2 * 86400_000);
    raceLocal.setUTCHours(15, 0, 0, 0);
    const raceUtcMs = raceLocal.getTime() - 2 * 3600_000;
    raceTsMs = raceUtcMs;
    const pad = (n) => String(n).padStart(2, '0');
    raceText = `Sonntag, ${pad(raceLocal.getUTCDate())}.${pad(raceLocal.getUTCMonth() + 1)}.${raceLocal.getUTCFullYear()} · ${pad(raceLocal.getUTCHours())}:${pad(raceLocal.getUTCMinutes())} Uhr`;
  }

  let trackImage = null;
  if (slug) {
    try {
      const sp = await fetchPage(`${BASE}/formel-1/rennstrecken/${slug}`);
      const mt = sp.match(/(https:\/\/www\.motorsport-total\.com\/img\/portraet\/formel-1\/strecken\/[^"]+\.png)/);
      if (mt) trackImage = mt[1];
    } catch {
      /* ignorieren */
    }
  }

  const geo = findCircuitGeo(slug, country);

  return {
    name: `Großer Preis von ${country}`,
    circuit,
    country,
    flag,
    trackImage,
    geo,
    raceText,
    raceTimestamp: raceTsMs,
  };
}

// ---------------------------------------------------------------------------
//  Rennergebnisse (Saisonübersicht + einzelnes Rennen)
// ---------------------------------------------------------------------------
const POINTS_BY_POS = { 1: 25, 2: 18, 3: 15, 4: 12, 5: 10, 6: 8, 7: 6, 8: 4, 9: 2, 10: 1 };

/**
 * Saisonübersicht: Liste aller Rennen mit Flagge, Datum, Sieger und Slug
 * (Slug fehlt bei noch nicht ausgetragenen Rennen -> hasResult=false).
 */
function parseSeasonOverview(html) {
  const tables = findTables(html);
  let bestRows = [];
  for (const t of tables) {
    const rows = parseTableRows(t);
    const dataRows = rows.filter((r) => r[0] && /^\d{1,2}\.$/.test(r[0].text));
    if (dataRows.length > bestRows.length) bestRows = dataRows;
  }
  return bestRows.map((cells) => {
    const round = parseInt(cells[0].text, 10);
    const nameCell = cells[2] || {};
    const name = nameCell.text || '';
    let slug = null;
    if (nameCell.href) {
      const mm = nameCell.href.match(/\/ergebnisse\/\d{4}\/([^/]+)/);
      if (mm) slug = mm[1];
    }
    const date = cells[3] ? cells[3].text : '';
    const winner = cells[4] ? cells[4].text : '';
    const countryMatch = name.match(/Preis (?:von|der|von der|de[rs]?)\s+([^/]+?)(?:\s*\/|$)/i);
    const rawCountry = countryMatch ? countryMatch[1].trim() : name;
    const country = resolveCountryName(rawCountry, name);
    const flag = resolveFlag(rawCountry, name);
    const geo = findCircuitGeo(slug, rawCountry) || (() => {
      const hay = normalize(name);
      return CIRCUIT_GEO.find((c) => c.match.some((m) => hay.includes(normalize(m)))) || null;
    })();
    return {
      round, name, country, flag, date, winner: winner || null, slug,
      hasResult: Boolean(slug && winner),
      geo: geo ? { lat: geo.lat, lng: geo.lng, city: geo.city, track: geo.track } : null,
    };
  }).sort((a, b) => a.round - b.round);
}

/**
 * Erkennt eine Fahrer-Ergebnistabelle unabhängig von Überschriften/Position:
 * mindestens eine Zeile mit Link auf ".../fahrer/..." und Pos.-Zelle, die
 * eine Zahl oder "-" ist. Robuster als "Tabelle nach Überschrift X", falls
 * sich die Seitenstruktur mal minimal ändert.
 */
function isDriverResultTable(rows) {
  return rows.some((r) => r[2] && r[2].href && /\/fahrer\//.test(r[2].href) && r[0] && /^(\d+|-)$/.test(r[0].text));
}

// Trainings-/Qualifying-/Sprint-Ergebnisse: gleiche Quelle wie das Rennergebnis,
// nur andere Unterseite. Nicht jedes Rennwochenende hat alle Sessions (z.B. nur
// Sprint-Wochenenden haben "sprint-qualifying"/"sprint") - fehlende Seiten
// liefern einfach keine passende Tabelle und werden dann stillschweigend
// übersprungen (kein Sprint dieses Wochenende -> keine Fehlermeldung nötig).
const SESSION_DEFS = [
  { key: 'fp1', label: '1. Training', slug: '1-freies-training' },
  { key: 'fp2', label: '2. Training', slug: '2-freies-training' },
  { key: 'fp3', label: '3. Training', slug: '3-freies-training' },
  { key: 'sprintQualifying', label: 'Sprint-Qualifying', slug: 'sprint-qualifying' },
  { key: 'sprint', label: 'Sprint', slug: 'sprint' },
  { key: 'qualifying', label: 'Qualifying', slug: 'qualifying' },
];

/**
 * Generischer Session-Parser für Training/Qualifying/Sprint: robuster als ein
 * fest verdrahtetes Spaltenschema, da sich die Spalten je Session-Typ leicht
 * unterscheiden (Training: Runden/Zeit/Rückstand, Qualifying: Zeit je Segment,
 * Sprint: wie ein Kurz-Rennen). Nimmt einfach alle vorhandenen Spalten mit.
 */
function parseSessionGeneric(html) {
  const tables = findTables(html).map(parseTableRows).filter(isDriverResultTable);
  const rows = tables[0] || [];
  const out = [];
  for (const cells of rows) {
    const posText = (cells[0] && cells[0].text) || '';
    if (!/^(\d+|-)$/.test(posText)) continue;
    const driverName = (cells[2] && cells[2].text) || '';
    if (!driverName) continue;
    out.push({
      pos: /^\d+$/.test(posText) ? parseInt(posText, 10) : null,
      carNo: cells[1] ? cells[1].text : '',
      driverShort: driverName,
      team: cells[3] ? cells[3].text : '',
      c1: cells[4] ? cells[4].text : '',
      c2: cells[5] ? cells[5].text : '',
      c3: cells[6] ? cells[6].text : '',
      c4: cells[7] ? cells[7].text : '',
    });
  }
  return out;
}

/**
 * Rennergebnis einer einzelnen Strecke: Gesamtklassement + Ausfälle.
 * Punkte werden nach dem Standardschema (25-18-...-1 für P1-P10) berechnet;
 * Zusatzpunkte (z.B. schnellste Runde) werden dabei nicht berücksichtigt.
 */
function parseRaceResult(html, meta) {
  const resultTables = findTables(html).map(parseTableRows).filter(isDriverResultTable);
  // 1. gefundene Tabelle = Gesamtklassement (inkl. klassifizierter Ausfälle wie
  //    "Abflug" nach >90% Renndistanz), 2. Tabelle = "Ausfälle" (nicht klassifiziert).
  const classRows = resultTables[0] || [];
  const dnfRows = resultTables[1] || [];

  const parseDriverRows = (rows, isDnf) => {
    const out = [];
    for (const cells of rows) {
      if (cells.length === 1) {
        // Einzelzeilige Anmerkung -> entweder eine Zeitstrafe (Fahrer ist
        // trotzdem regulär im Ziel!) oder ein echter Ausfallgrund. Nur
        // Ausfallgründe markieren den Fahrer als DNF, Strafen werden nur als
        // kleine Bemerkung angehängt.
        const txt = (cells[0].text || '').trim();
        if (txt && !/^Pos\.?\s*=/.test(txt) && out.length) {
          const last = out[out.length - 1];
          const isPenalty = /strafe|zeitzuschlag|durchfahrt|verwarnung/i.test(txt);
          if (isPenalty) {
            last.penalty = txt; // z.B. "5 Sek. Zeitstrafe wegen Kollision" - Fahrer bleibt klassifiziert
          } else {
            const grundMatch = txt.match(/^Grund:\s*(.*)$/);
            if (grundMatch) {
              if (grundMatch[1].trim()) last.reason = grundMatch[1].trim();
            } else {
              last.reason = txt; // z.B. "Abflug" ohne "Grund:"-Präfix
            }
            last.dnf = true;
          }
        }
        continue;
      }
      const posText = (cells[0] && cells[0].text) || '';
      if (!/^\d+$/.test(posText) && posText !== '-') continue; // Header/Legende/Leerzeile überspringen
      const driverCell = cells[2] || {};
      const teamCell = cells[3] || {};
      const driverName = driverCell.text || '';
      if (!driverName) continue;
      const classified = /^\d+$/.test(posText); // hat eine echte Position -> gewertet (auch wenn ausgefallen)
      const pos = classified ? parseInt(posText, 10) : null;
      out.push({
        pos,
        carNo: cells[1] ? cells[1].text : '',
        driverShort: driverName, // z.B. "A. Antonelli"
        team: teamCell.text || '',
        laps: cells[4] ? cells[4].text : '',
        gapLeader: cells[5] ? cells[5].text : '',
        gapAhead: cells[6] ? cells[6].text : '',
        speed: cells[7] ? cells[7].text : '',
        points: pos && POINTS_BY_POS[pos] ? POINTS_BY_POS[pos] : 0,
        dnf: isDnf || !classified,
        reason: null,
        penalty: null,
      });
    }
    return out;
  };

  const results = parseDriverRows(classRows, false);
  const dnf = parseDriverRows(dnfRows, true);

  return { ...meta, results, dnf };
}

// ---------------------------------------------------------------------------
//  Bildveredelung: hellen/weißen Hintergrund entfernen + auf den Inhalt
//  zuschneiden. Wird für Team-Logos (weißer Kasten drumherum) und das
//  Streckenbild beim nächsten Rennen (Foto auf hellem Untergrund) genutzt.
//  Vorgehen: Hintergrundfarbe aus den 4 Bildecken schätzen, alle ähnlichen
//  Pixel transparent machen, dann auf den verbleibenden Inhalt zuschneiden.
// ---------------------------------------------------------------------------
const imgCache = new Map(); // Quell-URL -> { buf, ts }
const IMG_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 Std. – Logos/Streckenbilder ändern sich praktisch nie

async function cutoutImage(inputBuffer, threshold = 38) {
  const base = sharp(inputBuffer).ensureAlpha();
  const { data, info } = await base.raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  if (!width || !height) throw new Error('leeres Bild');
  const total = width * height;

  // Prüfen, ob das Bild bereits einen echten Alphakanal hat (typisch für
  // Logo-PNGs). Falls ja: NICHT per Eckenfarbe freistellen (das würde z.B.
  // schwarze Logo-Elemente fälschlich mit "transparentem Schwarz" verwechseln
  // und Löcher reinreißen) – nur auf den Inhalt zuschneiden.
  let transparentCount = 0;
  for (let i = 0; i < total; i++) {
    if (data[i * channels + 3] < 10) transparentCount++;
  }
  const hasRealAlpha = transparentCount / total > 0.02;

  if (!hasRealAlpha) {
    const px = (x, y) => {
      const idx = (y * width + x) * channels;
      return [data[idx], data[idx + 1], data[idx + 2]];
    };
    const corners = [px(0, 0), px(width - 1, 0), px(0, height - 1), px(width - 1, height - 1)];
    const bg = [0, 1, 2].map((c) => Math.round(corners.reduce((s, p) => s + p[c], 0) / 4));
    for (let i = 0; i < total; i++) {
      const idx = i * channels;
      const r = data[idx], g = data[idx + 1], b = data[idx + 2];
      const d = Math.sqrt((r - bg[0]) ** 2 + (g - bg[1]) ** 2 + (b - bg[2]) ** 2);
      if (d < threshold) data[idx + 3] = 0; // ähnlich der Hintergrundfarbe -> transparent
    }
  }

  const out = sharp(data, { raw: { width, height, channels } }).png();
  try {
    return await out.trim({ threshold: 10 }).toBuffer(); // Ränder ohne Inhalt wegschneiden
  } catch {
    return out.toBuffer(); // trim() wirft, wenn nichts übrig bleibt -> ungeschnitten zurückgeben
  }
}

async function getProcessedImage(url) {
  const cached = imgCache.get(url);
  if (cached && Date.now() - cached.ts < IMG_CACHE_TTL_MS) return cached.buf;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error('Bild-Fehler ' + res.status);
  const raw = Buffer.from(await res.arrayBuffer());
  let buf;
  try {
    buf = sharp ? await cutoutImage(raw) : raw;
  } catch {
    buf = raw; // Freistellen fehlgeschlagen (z.B. GIF/unbekanntes Format) -> Original ausliefern
  }
  imgCache.set(url, { buf, ts: Date.now() });
  return buf;
}

const seasonCache = { ts: 0, data: null };
const raceCache = new Map(); // slug -> Ergebnis (Renn-Ergebnisse ändern sich nach Rennende nicht mehr)

async function getSeason() {
  const now = Date.now();
  if (!seasonCache.data || now - seasonCache.ts > CACHE_TTL_MS) {
    try {
      const html = await fetchPage(`${BASE}/formel-1/ergebnisse/${YEAR}`);
      seasonCache.data = { year: YEAR, races: parseSeasonOverview(html) };
      seasonCache.ts = now;
    } catch (e) {
      if (!seasonCache.data) return { year: YEAR, races: [], error: String(e) };
    }
  }
  return seasonCache.data;
}

// ---------------------------------------------------------------------------
//  Formel-1-News (Übersichtsseite) - nur Überschrift, Bild, Zeit + Link zum
//  Originalartikel. Bewusst KEIN Volltext/Teaser-Fließtext, um nicht mehr vom
//  Artikel zu übernehmen als eine reine Kopfzeilen-Übersicht (Urheberrecht).
// ---------------------------------------------------------------------------
function parseNewsList(html) {
  const items = [];
  const seen = new Set();

  // Strategie A: Überschriften-Links (<h2>/<h3> mit <a href>) - das robustere,
  // semantisch stabilere Muster für Artikel-Listings.
  const headRe = /<h[23][^>]*>\s*<a\s+[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h[23]>/gi;
  let m;
  while ((m = headRe.exec(html)) !== null) {
    let [, href, titleHtml] = m;
    if (!/\/formel-1\/news\//.test(href)) continue;
    if (!href.startsWith('http')) href = BASE + (href.startsWith('/') ? href : '/' + href);
    if (seen.has(href)) continue;
    const title = fixMojibake(titleHtml.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').trim());
    if (!title) continue;
    seen.add(href);
    const before = html.slice(Math.max(0, m.index - 1200), m.index);
    const imgMatches = [...before.matchAll(/<img[^>]+src="([^"]*\/img\/\d{4}\/\d{6}\/[^"]+\.(?:webp|jpg|png))"/gi)];
    const img = imgMatches.length ? imgMatches[imgMatches.length - 1][1] : null;
    const after = html.slice(headRe.lastIndex, Math.min(html.length, headRe.lastIndex + 800));
    const timeMatch = after.match(/(\d{1,2}:\d{2})\s*Uhr/);
    items.push({ url: href, title, image: img, time: timeMatch ? timeMatch[1] + ' Uhr' : null });
  }

  // Strategie B: Bild-Link mit title-Attribut (Fallback, falls Strategie A auf
  // der echten Seite nichts findet oder Bilder verpasst) - Attribut-Reihenfolge
  // im <a>-Tag wird bewusst nicht fest angenommen.
  const imgLinkRe = /<a\s+([^>]*?)>\s*<img[^>]+src="([^"]*\/img\/\d{4}\/\d{6}\/[^"]+\.(?:webp|jpg|png))"/gi;
  while ((m = imgLinkRe.exec(html)) !== null) {
    const attrs = m[1];
    const img = m[2];
    const hrefMatch = attrs.match(/href="([^"]+)"/);
    const titleMatch = attrs.match(/title="([^"]*)"/);
    if (!hrefMatch) continue;
    let href = hrefMatch[1];
    if (!href.startsWith('http')) href = BASE + (href.startsWith('/') ? href : '/' + href);
    if (seen.has(href) || !/\/formel-1\/news\//.test(href)) continue;
    let title = fixMojibake((titleMatch ? titleMatch[1] : '').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').trim());
    if (!title) continue;
    seen.add(href);
    const chunk = html.slice(imgLinkRe.lastIndex, Math.min(html.length, imgLinkRe.lastIndex + 1500));
    const timeMatch = chunk.match(/(\d{1,2}:\d{2})\s*Uhr/);
    items.push({ url: href, title, image: img, time: timeMatch ? timeMatch[1] + ' Uhr' : null });
  }

  return items.slice(0, 80);
}

const newsCache = { ts: 0, data: null };
// ---------------------------------------------------------------------------
//  Wetter fürs nächste Rennwochenende (Open-Meteo, kostenlos, kein API-Key
//  nötig) - nutzt die Streckenkoordinaten, die wir für die Karte sowieso schon
//  haben. Open-Meteo liefert bis zu 16 Tage Vorhersage; liegt das Rennen
//  weiter in der Zukunft, gibt's einfach nur die aktuellen Wetterdaten zurück.
// ---------------------------------------------------------------------------
const WEATHER_CODE_INFO = {
  0: { icon: '☀️', label: 'Klar' }, 1: { icon: '🌤️', label: 'Meist klar' },
  2: { icon: '⛅', label: 'Teilweise bewölkt' }, 3: { icon: '☁️', label: 'Bewölkt' },
  45: { icon: '🌫️', label: 'Nebel' }, 48: { icon: '🌫️', label: 'Reifnebel' },
  51: { icon: '🌦️', label: 'Leichter Nieselregen' }, 53: { icon: '🌦️', label: 'Nieselregen' }, 55: { icon: '🌧️', label: 'Starker Nieselregen' },
  61: { icon: '🌦️', label: 'Leichter Regen' }, 63: { icon: '🌧️', label: 'Regen' }, 65: { icon: '🌧️', label: 'Starker Regen' },
  71: { icon: '🌨️', label: 'Leichter Schneefall' }, 73: { icon: '🌨️', label: 'Schneefall' }, 75: { icon: '❄️', label: 'Starker Schneefall' },
  80: { icon: '🌦️', label: 'Regenschauer' }, 81: { icon: '🌧️', label: 'Regenschauer' }, 82: { icon: '⛈️', label: 'Heftige Regenschauer' },
  95: { icon: '⛈️', label: 'Gewitter' }, 96: { icon: '⛈️', label: 'Gewitter mit Hagel' }, 99: { icon: '⛈️', label: 'Schweres Gewitter' },
};
function weatherInfo(code) { return WEATHER_CODE_INFO[code] || { icon: '🌡️', label: 'Unbekannt' }; }

const weatherCache = { ts: 0, key: null, data: null };
async function getWeather(lat, lng) {
  const key = `${lat},${lng}`;
  const now = Date.now();
  if (weatherCache.data && weatherCache.key === key && now - weatherCache.ts < 30 * 60_000) return weatherCache.data;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
    `&current=temperature_2m,weather_code,wind_speed_10m,precipitation_probability` +
    `&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max` +
    `&timezone=auto&forecast_days=16`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Wetter-Fehler ' + res.status);
  const json = await res.json();
  const data = {
    current: json.current ? {
      temp: Math.round(json.current.temperature_2m),
      wind: Math.round(json.current.wind_speed_10m),
      precipProb: json.current.precipitation_probability,
      ...weatherInfo(json.current.weather_code),
    } : null,
    daily: (json.daily && json.daily.time || []).map((date, i) => ({
      date,
      max: Math.round(json.daily.temperature_2m_max[i]),
      min: Math.round(json.daily.temperature_2m_min[i]),
      precipProb: json.daily.precipitation_probability_max[i],
      ...weatherInfo(json.daily.weather_code[i]),
    })),
  };
  weatherCache.data = data;
  weatherCache.ts = now;
  weatherCache.key = key;
  return data;
}

// ---------------------------------------------------------------------------
//  Session-Zeitplan fürs NÄCHSTE Rennwochenende (1./2./3. Training, ggf.
//  Sprint-Qualifying/Sprint, Qualifying, Rennen) - für den gestuften Countdown
//  auf der Home-Seite. Quelle: die Kalenderseite, die am Anfang genau diesen
//  Zeitplan für das kommende Rennen ausweist (offiziell in MESZ/MEZ).
// ---------------------------------------------------------------------------
function berlinTimeToUtcMs(dateStr, timeStr) {
  const [d, mo, y] = dateStr.split('.').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  const guessUtc = Date.UTC(y, mo - 1, d, hh, mm);
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Berlin', timeZoneName: 'shortOffset' });
  const offsetPart = fmt.formatToParts(new Date(guessUtc)).find((p) => p.type === 'timeZoneName');
  const offsetMatch = offsetPart && offsetPart.value.match(/GMT([+-]\d+)/);
  const offsetHours = offsetMatch ? parseInt(offsetMatch[1], 10) : 1;
  return guessUtc - offsetHours * 3600_000;
}

const SESSION_LINE_LABELS = {
  '1. Freies Training': '1. Training', '2. Freies Training': '2. Training', '3. Freies Training': '3. Training',
  'Sprint-Qualifying': 'Sprint-Qualifying', 'Sprint': 'Sprint', 'Qualifying': 'Qualifying', 'Rennen / Formel 1 Start': 'Rennen',
};

function parseSessionScheduleFromCalendarHtml(html) {
  const startIdx = html.search(/Formel-1-Zeitplan und Start/i);
  if (startIdx === -1) return [];
  const endMarkerIdx = html.indexOf('Folgende Formel-1-Rennen', startIdx);
  const section = html.slice(startIdx, endMarkerIdx === -1 ? startIdx + 4000 : endMarkerIdx);
  const text = fixMojibake(section.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' '));

  const re = /(Freitag|Samstag|Sonntag),\s*(\d{2}\.\d{2}\.\d{4})|(1\.\s*Freies Training|2\.\s*Freies Training|3\.\s*Freies Training|Sprint-Qualifying|Sprint|Qualifying|Rennen\s*\/\s*Formel\s*1\s*Start)\s*:\s*(\d{1,2}:\d{2})\s*Uhr/g;
  let currentDate = null;
  const sessions = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m[1]) {
      currentDate = m[2];
    } else if (m[3] && currentDate) {
      const name = m[3].replace(/\s+/g, ' ').trim();
      const label = SESSION_LINE_LABELS[name] || name;
      sessions.push({ key: label, label, timestamp: berlinTimeToUtcMs(currentDate, m[4]) });
    }
  }
  return sessions;
}

async function getNews() {
  const now = Date.now();
  if (newsCache.data && now - newsCache.ts < CACHE_TTL_MS) return newsCache.data;
  try {
    const html = await fetchPage(`${BASE}/formel-1/news`);
    newsCache.data = { updated: new Date().toISOString(), items: parseNewsList(html) };
    newsCache.ts = now;
  } catch (e) {
    if (!newsCache.data) return { updated: new Date().toISOString(), items: [], error: String(e) };
  }
  return newsCache.data;
}

async function getRaceResult(slug) {
  if (raceCache.has(slug)) return raceCache.get(slug);
  const season = await getSeason();
  const meta = (season.races || []).find((r) => r.slug === slug);
  if (!meta) throw new Error('Unbekanntes Rennen: ' + slug);
  const html = await fetchPage(`${BASE}/formel-1/ergebnisse/${YEAR}/${slug}/rennen`);
  const result = parseRaceResult(html, meta);

  // Training/Qualifying/Sprint parallel laden - falls es eine Session nicht
  // gab (z.B. kein Sprint an diesem Wochenende), kommt einfach eine leere
  // Liste zurück und die Session wird unten weggelassen.
  const sessionResults = await Promise.allSettled(
    SESSION_DEFS.map((def) => fetchPage(`${BASE}/formel-1/ergebnisse/${YEAR}/${slug}/${def.slug}`))
  );
  result.sessions = SESSION_DEFS.map((def, i) => {
    const r = sessionResults[i];
    if (r.status !== 'fulfilled') return null;
    const rows = parseSessionGeneric(r.value);
    return rows.length ? { key: def.key, label: def.label, rows } : null;
  }).filter(Boolean);

  raceCache.set(slug, result);
  return result;
}


// ---------------------------------------------------------------------------
//  Saisonverlauf: kumulierte Punkte pro Fahrer nach jedem Rennen
//  (für das Punkteverlauf-Diagramm und den Fahrervergleich)
// ---------------------------------------------------------------------------
const progressCache = { ts: 0, data: null };

async function buildSeasonProgress() {
  const season = await getSeason();
  const racedRounds = (season.races || []).filter((r) => r.hasResult).sort((a, b) => a.round - b.round);
  const mainData = await getData();
  const bySurname = {};
  for (const d of mainData.drivers || []) bySurname[normalize(d.short)] = d;

  const rounds = [];
  const cumulative = {};
  const wins = {};
  const podiums = {};
  const series = {};
  const meta = {};
  const teamWins = {};
  const teamPodiums = {};
  const incidentCount = {};
  const crashCount = {};
  const mechCount = {};
  const incidentLog = {};
  const bestPos = {};
  const starts = {};
  const CRASH_WORDS = /unfall|kollision|dreher|ausritt|kontakt|crash|abflug|barriere|leitplanke/i;
  const MECH_WORDS = /motor|getriebe|hydraulik|elektrik|aufhängung|bremse|defekt|technisch|kühlung|antrieb|reifen|schaden am/i;

  for (const r of racedRounds) {
    let race;
    try { race = await getRaceResult(r.slug); } catch { continue; }
    rounds.push({ round: r.round, name: r.name, country: r.country, flag: r.flag, date: r.date });
    const seen = new Set();
    for (const row of race.results || []) {
      const key = row.driverShort;
      seen.add(key);
      cumulative[key] = (cumulative[key] || 0) + (row.points || 0);
      starts[key] = (starts[key] || 0) + 1;
      if (row.pos) bestPos[key] = Math.min(bestPos[key] ?? Infinity, row.pos);
      const surnameTok = key.split(' ').slice(-1)[0];
      const known = bySurname[normalize(surnameTok)];
      const tid = known ? known.teamId : null;
      if (row.pos === 1) { wins[key] = (wins[key] || 0) + 1; if (tid) teamWins[tid] = (teamWins[tid] || 0) + 1; }
      if (row.pos && row.pos <= 3) { podiums[key] = (podiums[key] || 0) + 1; if (tid) teamPodiums[tid] = (teamPodiums[tid] || 0) + 1; }
      if (!meta[key]) {
        meta[key] = known
          ? { display: known.display, teamColor: known.teamColor, teamName: known.teamName, photo: known.photo, photoFallback: known.photoFallback, natFlag: known.natFlag, natCode: known.natCode }
          : { display: key, teamColor: '#888', teamName: row.team, photo: null, natFlag: null, natCode: null };
        series[key] = new Array(rounds.length - 1).fill(0); // für frühere Runden mit 0 auffüllen
      }
      series[key].push(cumulative[key]);
    }
    // Fahrer ohne Ergebnis in dieser Runde (z.B. DNF/nicht angetreten) -> Stand halten
    for (const key of Object.keys(series)) {
      if (!seen.has(key)) series[key].push(cumulative[key] || 0);
    }
    // Ausfälle mit Grund erfassen (echte Daten aus der Ergebnisseite, keine geschätzten Kosten)
    for (const row of race.dnf || []) {
      const key = row.driverShort;
      starts[key] = (starts[key] || 0) + 1;
      const surnameTok = key.split(' ').slice(-1)[0];
      const known = bySurname[normalize(surnameTok)];
      if (!meta[key]) {
        meta[key] = known
          ? { display: known.display, teamColor: known.teamColor, teamName: known.teamName, photo: known.photo, photoFallback: known.photoFallback, natFlag: known.natFlag, natCode: known.natCode }
          : { display: key, teamColor: '#888', teamName: row.team, photo: null, natFlag: null, natCode: null };
        series[key] = new Array(rounds.length - 1).fill(cumulative[key] || 0);
        if (!seen.has(key)) series[key].push(cumulative[key] || 0);
      }
      incidentCount[key] = (incidentCount[key] || 0) + 1;
      const reason = row.reason || 'Unbekannt';
      if (CRASH_WORDS.test(reason)) crashCount[key] = (crashCount[key] || 0) + 1;
      else if (MECH_WORDS.test(reason)) mechCount[key] = (mechCount[key] || 0) + 1;
      if (!incidentLog[key]) incidentLog[key] = [];
      incidentLog[key].push({ round: r.round, race: r.country, reason });
    }
  }

  const drivers = Object.keys(meta).map((key) => ({
    key, ...meta[key],
    total: cumulative[key] || 0,
    wins: wins[key] || 0,
    podiums: podiums[key] || 0,
    series: series[key] || [],
    incidents: incidentCount[key] || 0,
    crashes: crashCount[key] || 0,
    mechanical: mechCount[key] || 0,
    incidentLog: incidentLog[key] || [],
    starts: starts[key] || 0,
    bestPos: Number.isFinite(bestPos[key]) ? bestPos[key] : null,
    avgPoints: starts[key] ? Math.round(((cumulative[key] || 0) / starts[key]) * 10) / 10 : 0,
  })).sort((a, b) => b.total - a.total);

  const teams = (mainData.teams || []).map((t) => ({
    id: t.id, name: t.name, color: t.color, logo: t.logo, points: t.points,
    wins: teamWins[t.id] || 0, podiums: teamPodiums[t.id] || 0,
  })).sort((a, b) => b.points - a.points);

  return { season: YEAR, rounds, totalRounds: (season.races || []).length, drivers, teams };
}

async function getSeasonProgress() {
  const now = Date.now();
  if (!progressCache.data || now - progressCache.ts > CACHE_TTL_MS) {
    try {
      progressCache.data = await buildSeasonProgress();
      progressCache.ts = now;
    } catch (e) {
      if (!progressCache.data) return { season: YEAR, rounds: [], drivers: [], error: String(e) };
    }
  }
  return progressCache.data;
}

async function buildData() {
  const errors = {};

  let standings = [];
  try {
    const html = await fetchPage(`${BASE}/formel-1/ergebnisse/wm-stand/${YEAR}/fahrerwertung`);
    standings = parseDriverStandings(html);
  } catch (e) {
    errors.standings = String(e);
  }

  let teams = {}, code2team = {}, team2codes = {};
  try {
    const html = await fetchPage(`${BASE}/formel-1/teams-und-fahrer`);
    ({ teams, code2team, team2codes } = parseTeams(html));
  } catch (e) {
    errors.teams = String(e);
  }

  const allCodes = Object.keys(code2team);
  const codeToName = {};
  const drivers = [];
  const teamPoints = {};

  for (const { pos, name, pts } of standings) {
    const code = matchCode(name, allCodes);
    const tid = code ? code2team[code] : null;
    let photo = null;
    if (tid && teams[tid] && teams[tid].photos[code]) photo = teams[tid].photos[code];
    const photoFallback = photo; // motorsport-total-Foto als Rückfalloption

    const toks = name.split(/\s+/).map(normalize);
    const nat = toks.map((t) => DRIVER_NAT[t]).find((v) => v) || null;
    const meta = TEAM_META[tid] || { name: '', color: '#888' };
    if (tid) teamPoints[tid] = (teamPoints[tid] || 0) + pts;

    let display = name;
    let surname = name.split(' ').slice(-1)[0];
    if (code) {
      const orig = name.split(' ').find((t) => normalize(t) === code.slice(1));
      if (orig) {
        display = `${name.split(' ')[0]} ${orig}`;
        surname = orig;
      }
      codeToName[code] = display;
    }
    // Schärferes Fahrerporträt: eigenes hochgeladenes Bild, falls vorhanden,
    // sonst formula1dashboard.com (300x300, Cloudflare-Bildskalierung) über
    // unseren Proxy; fällt automatisch auf das motorsport-total-Foto zurück,
    // falls die jeweilige Quelle mal nicht erreichbar ist.
    const localPhoto = DRIVER_PHOTO_OVERRIDES[normalize(surname)];
    const sharpPhoto = localPhoto || ('/api/img?src=' + encodeURIComponent(
      `https://cdn.formula1dashboard.com/cdn-cgi/image/width=400,height=400,fit=crop,format=auto,dpr=1/drivers/2026/portrait/2026-${normalize(surname)}.png`
    ));

    drivers.push({
      pos, name, display, short: surname, points: pts,
      teamId: tid, teamName: meta.name, teamColor: meta.color,
      photo: sharpPhoto, photoFallback,
      natCode: nat, natFlag: nat ? flagUrl(IOC3_TO_ISO2[nat] || null) : null,
    });
  }

  const teamRows = [];
  for (const [tid, info] of Object.entries(teams)) {
    const meta = TEAM_META[tid] || { name: tid[0].toUpperCase() + tid.slice(1), color: '#888' };
    const drvNames = (team2codes[tid] || []).map((c) => codeToName[c] || c[0].toUpperCase() + c.slice(1));
    teamRows.push({
      id: tid, name: meta.name, color: meta.color,
      logo: LOGO_OVERRIDES[tid] || info.logo, car: info.car,
      points: teamPoints[tid] || 0, drivers: drvNames,
      engine: ENGINE_SUPPLIER[tid] || null,
      chassis: CHASSIS_NAME[tid] || null,
      carImage2026: CAR_IMAGE_OVERRIDES[tid] || CAR_IMAGE_2026[tid] || null,
    });
  }
  teamRows.sort((a, b) => b.points - a.points);
  teamRows.forEach((t, i) => { t.pos = i + 1; });

  let nextRace = null;
  try {
    const html = await fetchPage(`${BASE}/formel-1/termin-kalender/${YEAR}`);
    nextRace = await parseNextRace(html);
    try {
      nextRace.sessions = parseSessionScheduleFromCalendarHtml(html);
    } catch {
      nextRace.sessions = [];
    }
  } catch (e) {
    errors.nextRace = String(e);
  }

  return {
    updated: new Date().toISOString(),
    season: YEAR,
    raceCount: standings.length,
    nextRace,
    drivers,
    teams: teamRows,
    errors,
  };
}

// ---------------------------------------------------------------------------
//  Cache + HTTP-Server
// ---------------------------------------------------------------------------
const cache = { ts: 0, data: null };

async function getData() {
  const now = Date.now();
  if (!cache.data || now - cache.ts > CACHE_TTL_MS) {
    try {
      cache.data = await buildData();
      cache.ts = now;
    } catch (e) {
      if (!cache.data) {
        return { error: String(e), drivers: [], teams: [], nextRace: null };
      }
    }
  }
  return cache.data;
}

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
};

const server = http.createServer(async (req, res) => {
  const urlPath = req.url.split('?')[0];

  if (urlPath === '/health') {
    const body = Buffer.from(JSON.stringify({ status: 'ok' }), 'utf-8');
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': body.length,
      'Cache-Control': 'no-store',
    });
    res.end(body);
    return;
  }

  if (urlPath === '/api/data') {
    const data = await getData();
    const body = Buffer.from(JSON.stringify(data), 'utf-8');
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': body.length,
      'Cache-Control': 'no-store',
    });
    res.end(body);
    return;
  }

  if (urlPath === '/api/season') {
    const data = await getSeason();
    const body = Buffer.from(JSON.stringify(data), 'utf-8');
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': body.length,
      'Cache-Control': 'no-store',
    });
    res.end(body);
    return;
  }

  if (urlPath === '/api/race') {
    const slug = new URL(req.url, 'http://localhost').searchParams.get('slug');
    if (!slug) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'slug fehlt' }));
      return;
    }
    try {
      const data = await getRaceResult(slug);
      const body = Buffer.from(JSON.stringify(data), 'utf-8');
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': body.length,
        'Cache-Control': 'no-store',
      });
      res.end(body);
    } catch (e) {
      const body = Buffer.from(JSON.stringify({ error: String(e) }), 'utf-8');
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(body);
    }
    return;
  }

  if (urlPath === '/api/weather') {
    try {
      const mainData = await getData();
      const geo = mainData.nextRace && mainData.nextRace.geo;
      if (!geo) throw new Error('Keine Koordinaten fürs nächste Rennen bekannt');
      const weather = await getWeather(geo.lat, geo.lng);
      const body = Buffer.from(JSON.stringify({ ...weather, city: geo.city }), 'utf-8');
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': body.length,
        'Cache-Control': 'no-store',
      });
      res.end(body);
    } catch (e) {
      const body = Buffer.from(JSON.stringify({ error: String(e) }), 'utf-8');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length });
      res.end(body);
    }
    return;
  }

  if (urlPath === '/api/news') {
    const data = await getNews();
    const body = Buffer.from(JSON.stringify(data), 'utf-8');
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': body.length,
      'Cache-Control': 'no-store',
    });
    res.end(body);
    return;
  }

  if (urlPath === '/api/season-progress') {
    const data = await getSeasonProgress();
    const body = Buffer.from(JSON.stringify(data), 'utf-8');
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': body.length,
      'Cache-Control': 'no-store',
    });
    res.end(body);
    return;
  }

  if (urlPath === '/api/img') {
    const src = new URL(req.url, 'http://localhost').searchParams.get('src');
    if (!src || !/^https:\/\/(www\.)?(motorsport-total\.com|cdn\.formula1dashboard\.com)\//.test(src)) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Ungueltige Bild-URL');
      return;
    }
    try {
      const buf = await getProcessedImage(src);
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Content-Length': buf.length,
        'Cache-Control': 'public, max-age=86400',
      });
      res.end(buf);
    } catch {
      res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Bild konnte nicht geladen werden');
    }
    return;
  }

  // Statische Dateien
  let relPath = urlPath === '/' ? '/index.html' : urlPath;
  const target = path.resolve(path.join(HERE, relPath));
  if (target.startsWith(HERE) && fs.existsSync(target) && fs.statSync(target).isFile()) {
    const ctype = CONTENT_TYPES[path.extname(target)] || 'application/octet-stream';
    const body = fs.readFileSync(target);
    res.writeHead(200, {
      'Content-Type': ctype,
      'Content-Length': body.length,
      'Cache-Control': 'no-store',
    });
    res.end(body);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

async function main() {
  console.log('='.repeat(60));
  console.log('  F1 Live Dashboard (Node.js)');
  console.log(`  Server laeuft:  http://localhost:${PORT}`);
  console.log('  Beenden mit:    STRG + C');
  console.log('='.repeat(60));
  if (!sharp) {
    console.log('  Hinweis: Paket "sharp" nicht gefunden -> Logos/Streckenbild werden ohne Freistellen angezeigt.');
    console.log('  Beheben mit: npm install');
  }
  // Render erwartet, dass der Dienst den zugewiesenen PORT schnell öffnet.
  // Das Vorladen externer Daten läuft deshalb erst nach dem Listen-Aufruf.
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`  HTTP-Server bereit auf Port ${PORT}`);
    console.log('  Lade erste Daten im Hintergrund (kurz Geduld)...');
    getData().then((d) => {
      const nr = d.nextRace || {};
      console.log(
        `  OK: ${(d.drivers || []).length} Fahrer, ${(d.teams || []).length} Teams. ` +
        `Naechstes Rennen: ${nr.name || '?'}`
      );
      if (d.errors && Object.keys(d.errors).length) {
        console.log('  Hinweise:', d.errors);
      }
    }).catch((e) => {
      console.log('  Warnung beim Vorladen:', e);
    });
  });
}

process.on('SIGINT', () => {
  console.log('\n  Server beendet.');
  process.exit(0);
});

main();
