import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const TABLE_COLUMNS = [
  { key: "rowNumber", label: "Row#" },
  { key: "ycLaunchPageLink", label: "YC Launch page link" },
  { key: "startupName", label: "Startup Name" },
  { key: "description", label: "Description" },
  { key: "url", label: "URL" },
  { key: "activeFounder1", label: "Active Founder1" },
  { key: "linkedInActiveFounder1", label: "LinkedIn Active Founder1" },
  { key: "activeFounder2", label: "Active Founder2" },
  { key: "linkedInActiveFounder2", label: "LinkedIn Active Founder2" },
  { key: "activeFounder3", label: "Active Founder3" },
  { key: "linkedInActiveFounder3", label: "LinkedIn Active Founder3" },
  { key: "launchVideoUrl", label: "Launch video URL" },
  { key: "pitchDeckLink", label: "Pitch deck link" },
  { key: "stage", label: "Stage" },
  { key: "existingInvestors", label: "Existing Investors" },
  { key: "launchTitle", label: "Launch Title" },
  { key: "tagline", label: "Tagline" },
  { key: "launchDate", label: "Launch Date" },
  { key: "votes", label: "Votes" },
  { key: "companyYcPage", label: "Company YC Page" },
  { key: "batch", label: "Batch" },
  { key: "batchCode", label: "Batch Code" },
  { key: "industry", label: "Industry" },
  { key: "tags", label: "Tags" },
  { key: "status", label: "Status" },
  { key: "founded", label: "Founded" },
  { key: "teamSize", label: "Team Size" },
  { key: "location", label: "Location" },
  { key: "companyLinkedIn", label: "Company LinkedIn" },
  { key: "companyTwitter", label: "Company Twitter/X" },
  { key: "companyGitHub", label: "Company GitHub" },
  { key: "companyCrunchbase", label: "Company Crunchbase" },
  { key: "primaryGroupPartner", label: "Primary Group Partner" },
  { key: "ddayVideoUrl", label: "Demo Day Video URL" },
  { key: "appVideoUrl", label: "Application Video URL" },
  { key: "extractedLinks", label: "Extracted Links" }
];

export async function writeExports(records, options = {}) {
  const {
    meta = {},
    outDir = "exports",
    dataDir = "data",
    basename = "yc-launches"
  } = options;

  await mkdir(outDir, { recursive: true });
  await mkdir(dataDir, { recursive: true });

  const jsonPath = path.join(dataDir, `${basename}.json`);
  const csvPath = path.join(outDir, `${basename}.csv`);
  const markdownPath = path.join(outDir, `${basename}.md`);

  await writeFile(jsonPath, JSON.stringify({ meta, records }, null, 2));
  await writeFile(csvPath, toCsv(records));
  await writeFile(markdownPath, toMarkdown(records, meta));

  return { jsonPath, csvPath, markdownPath };
}

export function toCsv(records, columns = TABLE_COLUMNS) {
  const header = columns.map((column) => csvEscape(column.label)).join(",");
  const rows = records.map((record) =>
    columns.map((column) => csvEscape(record[column.key])).join(",")
  );
  return [header, ...rows].join("\n");
}

export function toMarkdown(records, meta = {}, columns = TABLE_COLUMNS) {
  const compactColumns = columns.filter((column) =>
    [
      "rowNumber",
      "ycLaunchPageLink",
      "startupName",
      "description",
      "url",
      "activeFounder1",
      "linkedInActiveFounder1",
      "activeFounder2",
      "linkedInActiveFounder2",
      "activeFounder3",
      "linkedInActiveFounder3",
      "launchVideoUrl",
      "pitchDeckLink",
      "stage",
      "existingInvestors",
      "batch",
      "industry",
      "status",
      "votes"
    ].includes(column.key)
  );

  const lines = [
    "# YC Launches",
    "",
    `Source: ${meta.source || "https://www.ycombinator.com/launches/"}`,
    `Scraped at: ${meta.scrapedAt || new Date().toISOString()}`,
    "",
    "| " + compactColumns.map((column) => escapeMarkdown(column.label)).join(" | ") + " |",
    "| " + compactColumns.map(() => "---").join(" | ") + " |"
  ];

  for (const record of records) {
    lines.push(
      "| " +
        compactColumns
          .map((column) => escapeMarkdown(shorten(record[column.key], column.key === "description" ? 240 : 120)))
          .join(" | ") +
        " |"
    );
  }

  return `${lines.join("\n")}\n`;
}

function csvEscape(value) {
  if (value === null || value === undefined) {
    return "";
  }
  const text = Array.isArray(value) ? value.join(", ") : String(value);
  return `"${text.replace(/"/g, "\"\"")}"`;
}

function escapeMarkdown(value) {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value)
    .replace(/\r?\n/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

function shorten(value, maxLength) {
  if (value === null || value === undefined) {
    return "";
  }
  const text = String(value).replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 3).trim()}...`;
}
