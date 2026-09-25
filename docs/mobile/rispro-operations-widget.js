// RISpro Operations — paste this entire file into Scriptable.
// No credential belongs in this source. Run in the app to configure Keychain.
const KEYCHAIN_KEY = "rispro.operations.widget"; // Change for a second RISpro site.
const REFRESH_MS = 15 * 60 * 1000;
const COUNT_KEYS = ["totalAppointments", "scheduled", "arrived", "waiting", "inProgress", "inQueue", "completed", "noShow", "cancelled", "discontinued", "voided", "walkIn"];

function parseSummary(raw) {
  if (!raw || raw.schemaVersion !== 1) throw new Error("update");
  const count = value => {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error("malformed");
    return value;
  };
  const counts = value => Object.fromEntries(COUNT_KEYS.map(key => [key, count(value && value[key])]));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw.date) || raw.timezone !== "Africa/Tripoli"
    || typeof raw.generatedAt !== "string" || !Number.isFinite(Date.parse(raw.generatedAt))
    || !Array.isArray(raw.modalities) || raw.modalities.length > 200 || !raw.waiting) throw new Error("malformed");
  // Explicit projection: unexpected fields (including secrets or patient data)
  // are never displayed or saved in the last-good cache.
  return {
    schemaVersion: 1, date: raw.date, timezone: raw.timezone, generatedAt: raw.generatedAt,
    totals: counts(raw.totals),
    waiting: { count: count(raw.waiting.count), oldestWaitingMinutes: raw.waiting.oldestWaitingMinutes === null ? null : count(raw.waiting.oldestWaitingMinutes),
      over30Minutes: count(raw.waiting.over30Minutes), over60Minutes: count(raw.waiting.over60Minutes), unknownDurationCount: count(raw.waiting.unknownDurationCount) },
    modalities: raw.modalities.map(value => {
      if (typeof value.code !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(value.code)) throw new Error("malformed");
      return { code: value.code, ...counts(value) };
    }),
  };
}

function normalizeBase(value) {
  const base = String(value || "").trim().replace(/\/+$/, "");
  // Origin only. Reject credentials, paths, query strings and fragments.
  if (!/^https:\/\/[a-z0-9.-]+(?::\d{1,5})?$/i.test(base)) throw new Error("address");
  return base;
}

function selectModality(data, parameter) {
  const code = String(parameter || "all").trim().toUpperCase();
  return data.modalities.find(value => value.code.toUpperCase() === code) || null;
}

async function loadSummary(base, token, cache, now = new Date()) {
  if (!token || !/^rwm_[A-Za-z0-9_-]{43}$/.test(token)) return { data: null, state: "setup" };
  let cached = null;
  try { cached = parseSummary(cache.read()); } catch { /* An invalid cache is never trusted. */ }
  const age = cached ? now.getTime() - Date.parse(cached.generatedAt) : Infinity;
  // Avoid repeated network requests when iOS reruns the script in quick succession.
  if (cached && age >= 0 && age < REFRESH_MS) return { data: cached, state: "live" };
  try {
    const request = new Request(`${normalizeBase(base)}/api/mobile/operations-summary`);
    request.headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
    request.timeoutInterval = 15;
    request.onRedirect = () => null; // Never forward credentials to a redirect target.
    const text = await request.loadString();
    const status = request.response.statusCode;
    if (status === 401 || status === 403) { cache.clear(); return { data: null, state: "credential" }; }
    if (status !== 200) throw new Error("offline");
    const data = parseSummary(JSON.parse(text));
    try { cache.write(data); } catch { /* A storage failure does not discard a good response. */ }
    return { data, state: "live" };
  } catch (error) {
    return { data: cached, state: error.message === "update" ? "update" : "offline" };
  }
}

function renderWidget(result, family, parameter, base) {
  const widget = new ListWidget();
  widget.refreshAfterDate = new Date(Date.now() + REFRESH_MS);
  if (base) widget.url = `${normalizeBase(base)}/queue`;
  const accessory = family.startsWith("accessory");
  if (!accessory) { widget.backgroundColor = Color.dynamic(new Color("f5f7fa"), new Color("14202b")); widget.setPadding(14, 14, 14, 14); }
  else widget.addAccessoryWidgetBackground = true;
  const color = Color.dynamic(new Color("183747"), new Color("e7f0f6"));
  const muted = Color.dynamic(new Color("546779"), new Color("b7c8d5"));
  function text(value, size = 12, bold = false, tone = color) {
    const line = widget.addText(String(value)); line.font = bold ? Font.boldSystemFont(size) : Font.systemFont(size);
    if (!accessory) line.textColor = tone;
    line.lineLimit = 1; line.minimumScaleFactor = 0.7; return line;
  }
  const labels = { setup: "Run in Scriptable to set up", credential: "Token expired or revoked", offline: "Offline · stale", update: "Update widget script", live: "" };
  if (!result.data) { text("RISpro", 16, true); text(labels[result.state] || "Unavailable", 11); return widget; }
  const data = result.data;
  const selected = selectModality(data, parameter);
  const totals = selected || data.totals;
  const title = selected ? `RISpro · ${selected.code}` : "RISpro";
  const time = new Date(data.generatedAt).toLocaleTimeString("en-GB", { timeZone: "Africa/Tripoli", hour: "2-digit", minute: "2-digit" });
  const stale = result.state !== "live" || Date.now() - Date.parse(data.generatedAt) > REFRESH_MS * 2;
  const stamp = `${stale ? (labels[result.state] || "Stale") + " · " : ""}${data.date} ${time}`;
  if (family === "accessoryInline") { text(`${title} ${totals.totalAppointments} · W${totals.waiting} · ${stamp}`, 11); return widget; }
  if (family === "accessoryCircular") { text(title, 9, true); text(totals.totalAppointments, 18, true); text(`W${totals.waiting} S${totals.inProgress}`, 9); text(`${stale ? "Stale " : ""}${time}`, 8); return widget; }
  if (family === "accessoryRectangular") { text(`${title} ${totals.totalAppointments}`, 14, true); text(`Waiting ${totals.waiting} · Scan ${totals.inProgress} · Done ${totals.completed}`, 11); text(stamp, 9); return widget; }
  text(title, 13, true); widget.addSpacer(5);
  text(`${totals.totalAppointments} Today`, family === "small" ? 26 : 24, true);
  if (family === "small") {
    widget.addSpacer(4); text(`Waiting ${totals.waiting}`, 13); text(`Scanning ${totals.inProgress}`, 13);
  } else {
    text(`Waiting ${totals.waiting} · Scanning ${totals.inProgress} · Done ${totals.completed}`, 12);
    widget.addSpacer(7);
    const rows = selected ? [selected] : data.modalities;
    const max = family === "large" || family === "extraLarge" ? 8 : 3;
    rows.slice(0, max).forEach(row => text(`${row.code}   ${row.totalAppointments}   W${row.waiting}   Scan${row.inProgress}`, 12));
    if (rows.length > max) text(`+${rows.length - max} modalities`, 10, false, muted);
    if (!selected) {
      widget.addSpacer(5);
      const alert = data.waiting.over60Minutes ? new Color("cf4141") : data.waiting.over30Minutes ? new Color("ae6b18") : muted;
      text(`Oldest wait: ${data.waiting.oldestWaitingMinutes === null ? "—" : data.waiting.oldestWaitingMinutes + " min"}`, 11, false, alert);
      if (family === "large") text(`>30 min: ${data.waiting.over30Minutes} · >60 min: ${data.waiting.over60Minutes}`, 11, false, alert);
    }
  }
  widget.addSpacer(); text(stamp, 9, false, muted);
  return widget;
}

async function main() {
  const fm = FileManager.local();
  const cachePath = fm.joinPath(fm.cacheDirectory(), `${KEYCHAIN_KEY.replace(/[^a-z0-9._-]/gi, "_")}.json`);
  const cache = {
    read: () => JSON.parse(fm.readString(cachePath)),
    write: data => fm.writeString(cachePath, JSON.stringify(data)),
    clear: () => { if (fm.fileExists(cachePath)) fm.remove(cachePath); },
  };
  const baseKey = `${KEYCHAIN_KEY}.base`;
  if (config.runsInApp) {
    const menu = new Alert(); menu.title = "RISpro Operations";
    menu.addAction("Preview"); menu.addAction("Configure"); menu.addCancelAction("Cancel");
    const choice = await menu.presentSheet();
    if (choice === -1) { Script.complete(); return; }
    if (choice === 1 || !Keychain.contains(KEYCHAIN_KEY) || !Keychain.contains(baseKey)) {
      const setup = new Alert(); setup.title = "Configure RISpro"; setup.message = "Use your HTTPS RISpro address and a device token from Settings. The token is saved only in Keychain.";
      setup.addTextField("https://rispro.example", Keychain.contains(baseKey) ? Keychain.get(baseKey) : "");
      setup.addSecureTextField("Device token"); setup.addAction("Save"); setup.addCancelAction("Cancel");
      if (await setup.presentAlert() === -1) { Script.complete(); return; }
      try {
        const base = normalizeBase(setup.textFieldValue(0)); const token = setup.textFieldValue(1).trim();
        if (!/^rwm_[A-Za-z0-9_-]{43}$/.test(token)) throw new Error("token");
        Keychain.set(baseKey, base); Keychain.set(KEYCHAIN_KEY, token); cache.clear();
      } catch {
        const error = new Alert(); error.title = "Check your settings"; error.message = "Enter an HTTPS address without a path and the full device token."; error.addAction("OK"); await error.presentAlert(); Script.complete(); return;
      }
    }
  }
  let base = "";
  try { if (Keychain.contains(baseKey)) base = normalizeBase(Keychain.get(baseKey)); } catch { /* Show setup state. */ }
  const token = base && Keychain.contains(KEYCHAIN_KEY) ? Keychain.get(KEYCHAIN_KEY) : "";
  const result = await loadSummary(base, token, cache);
  const widget = renderWidget(result, config.widgetFamily || "medium", args.widgetParameter, base);
  Script.setWidget(widget);
  if (config.runsInApp) await widget.presentMedium();
  Script.complete();
}

await main();
