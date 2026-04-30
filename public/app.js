const columns = [
  ["rowNumber", "Row#"],
  ["ycLaunchPageLink", "YC Launch page link"],
  ["startupName", "Startup Name"],
  ["description", "Description"],
  ["url", "URL"],
  ["activeFounder1", "Active Founder1"],
  ["linkedInActiveFounder1", "LinkedIn Active Founder1"],
  ["activeFounder2", "Active Founder2"],
  ["linkedInActiveFounder2", "LinkedIn Active Founder2"],
  ["activeFounder3", "Active Founder3"],
  ["linkedInActiveFounder3", "LinkedIn Active Founder3"],
  ["launchVideoUrl", "Launch video URL"],
  ["pitchDeckLink", "Pitch deck link"],
  ["stage", "Stage"],
  ["existingInvestors", "Existing Investors"],
  ["batch", "Batch"],
  ["industry", "Industry"],
  ["tags", "Tags"],
  ["status", "Status"],
  ["votes", "Votes"],
  ["launchDate", "Launch Date"],
  ["companyYcPage", "Company YC Page"]
];

let records = [];
let meta = {};
const isStaticHost = location.protocol === "file:" || location.hostname.endsWith(".github.io");

const elements = {
  pages: document.querySelector("#pages"),
  controlPanel: document.querySelector("#controlPanel"),
  limit: document.querySelector("#limit"),
  concurrency: document.querySelector("#concurrency"),
  includeLaunchDetails: document.querySelector("#includeLaunchDetails"),
  includeCompanyDetails: document.querySelector("#includeCompanyDetails"),
  scrapeBtn: document.querySelector("#scrapeBtn"),
  loadBtn: document.querySelector("#loadBtn"),
  csvBtn: document.querySelector("#csvBtn"),
  jsonBtn: document.querySelector("#jsonBtn"),
  search: document.querySelector("#search"),
  clearSearchBtn: document.querySelector("#clearSearchBtn"),
  status: document.querySelector("#status"),
  recordCount: document.querySelector("#recordCount"),
  metaText: document.querySelector("#metaText"),
  headerRow: document.querySelector("#headerRow"),
  tableBody: document.querySelector("#tableBody")
};

renderHeader();
configureHostMode();
render();

elements.scrapeBtn?.addEventListener("click", scrape);
elements.loadBtn?.addEventListener("click", loadSaved);
elements.search?.addEventListener("input", render);
elements.clearSearchBtn?.addEventListener("click", () => {
  if (elements.search) {
    elements.search.value = "";
  }
  render();
  elements.search?.focus();
});
elements.csvBtn?.addEventListener("click", () =>
  download("yc-launches.csv", toCsv(filteredRecords()), "text/csv;charset=utf-8")
);
elements.jsonBtn?.addEventListener("click", () =>
  download(
    "yc-launches.json",
    JSON.stringify({ meta, records: filteredRecords() }, null, 2),
    "application/json;charset=utf-8"
  )
);

async function scrape() {
  if (isStaticHost) {
    setStatus("Scraping requires the local Node app. Clone the repo and run npm run dev to refresh data.");
    return;
  }

  setBusy(true, "Scraping YC Launches. Large runs can take a few minutes.");
  try {
    const payload = {
      pages: readInteger(elements.pages, 1, 1, 50),
      limit: readInteger(elements.limit, 0, 0, 10000),
      concurrency: readInteger(elements.concurrency, 4, 1, 10),
      includeLaunchDetails: elements.includeLaunchDetails?.checked ?? true,
      includeCompanyDetails: elements.includeCompanyDetails?.checked ?? true
    };
    const response = await fetch("/api/scrape", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Scrape failed");
    }
    records = data.records || [];
    meta = data.meta || {};
    setStatus(`Scraped ${records.length} launches. CSV and Markdown were written to exports/.`);
    render();
  } catch (error) {
    setStatus(error.message);
  } finally {
    setBusy(false);
  }
}

async function loadSaved() {
  setBusy(true, isStaticHost ? "Loading bundled data." : "Loading saved scrape.");
  try {
    const response = await fetch(isStaticHost ? "data/yc-launches.json" : "/api/data");
    const data = await response.json();
    if (!response.ok && !data.records?.length) {
      throw new Error(data.error || "No saved data");
    }
    records = data.records || [];
    meta = data.meta || {};
    setStatus(records.length ? `Loaded ${records.length} launches.` : "No data found.");
    render();
  } catch (error) {
    setStatus(error.message);
  } finally {
    setBusy(false);
  }
}

function renderHeader() {
  if (!elements.headerRow) {
    return;
  }
  elements.headerRow.innerHTML = columns.map(([, label]) => `<th>${escapeHtml(label)}</th>`).join("");
}

function render() {
  const visible = filteredRecords();
  const query = normalizedSearch(elements.search?.value);
  if (elements.recordCount) {
    elements.recordCount.textContent = query
      ? `${visible.length} of ${records.length} launch${records.length === 1 ? "" : "es"}`
      : `${visible.length} launch${visible.length === 1 ? "" : "es"}`;
  }
  if (elements.metaText) {
    elements.metaText.textContent = meta.scrapedAt
      ? `Scraped ${new Date(meta.scrapedAt).toLocaleString()} from ${meta.source}.`
      : "No data loaded.";
  }
  if (elements.clearSearchBtn) {
    elements.clearSearchBtn.disabled = !query;
  }

  if (!elements.tableBody) {
    return;
  }

  if (!visible.length) {
    const searchValue = elements.search?.value?.trim() || "";
    const message = records.length && query
      ? `No rows match "${escapeHtml(searchValue)}".`
      : "No rows to display. Scrape fresh data or load saved data first.";
    elements.tableBody.innerHTML = `<tr><td class="empty" colspan="${columns.length}">${message}</td></tr>`;
    return;
  }

  elements.tableBody.innerHTML = visible
    .map((record, index) => {
      const row = { ...record, rowNumber: index + 1 };
      return `<tr>${columns.map(([key]) => `<td>${formatValue(row[key])}</td>`).join("")}</tr>`;
    })
    .join("");
}

function filteredRecords() {
  const query = normalizedSearch(elements.search?.value);
  if (!query) {
    return records;
  }
  const terms = query.split(" ").filter(Boolean);
  return records.filter((record) => {
    const haystack = normalizedSearch(Object.values(record).filter(Boolean).join(" "));
    return terms.every((term) => haystack.includes(term));
  });
}

function formatValue(value) {
  if (value === null || value === undefined || value === "") {
    return "";
  }
  const text = String(value);
  if (/^https?:\/\//i.test(text)) {
    return `<a href="${escapeAttribute(text)}" target="_blank" rel="noreferrer">${escapeHtml(shorten(text, 72))}</a>`;
  }
  return escapeHtml(shorten(text, 420));
}

function toCsv(rows) {
  const header = columns.map(([, label]) => csvEscape(label)).join(",");
  const body = rows.map((record, index) =>
    columns.map(([key]) => csvEscape(key === "rowNumber" ? index + 1 : record[key])).join(",")
  );
  return [header, ...body].join("\n");
}

function csvEscape(value) {
  if (value === null || value === undefined) {
    return "";
  }
  return `"${String(value).replace(/"/g, "\"\"")}"`;
}

function download(filename, text, type = "text/plain;charset=utf-8") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function setBusy(isBusy, message = "") {
  if (elements.scrapeBtn) {
    elements.scrapeBtn.disabled = isStaticHost || isBusy;
  }
  if (elements.loadBtn) {
    elements.loadBtn.disabled = isBusy;
  }
  if (message) {
    setStatus(message);
  }
}

function configureHostMode() {
  if (!isStaticHost) {
    return;
  }
  if (elements.controlPanel) {
    elements.controlPanel.hidden = true;
    elements.controlPanel.setAttribute("aria-hidden", "true");
  }
  loadSaved();
}

function setStatus(message) {
  if (elements.status) {
    elements.status.textContent = message || "";
  }
}

function readInteger(input, fallback, min, max) {
  if (!input) {
    return fallback;
  }
  const number = Number.parseInt(input.value, 10);
  if (!Number.isFinite(number)) {
    input.value = String(fallback);
    return fallback;
  }
  const clamped = Math.min(max, Math.max(min, number));
  input.value = String(clamped);
  return clamped;
}

function shorten(value, maxLength) {
  const text = String(value).replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 3).trim()}...`;
}

function normalizedSearch(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}
