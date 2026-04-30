import { readFile } from "node:fs/promises";

const NOTION_API_VERSION = "2022-06-28";
const NOTION_API_BASE = "https://api.notion.com/v1";
const RICH_TEXT_CHUNK_SIZE = 1800;

export async function publishToNotion(records, options = {}) {
  const token = options.token || process.env.NOTION_TOKEN;
  const parentPageId = options.parentPageId || process.env.NOTION_PARENT_PAGE_ID;
  const existingDatabaseId = options.databaseId || process.env.NOTION_DATABASE_ID;
  const title = options.title || process.env.NOTION_DATABASE_TITLE || "YC Launches";

  if (!token) {
    throw new Error("Missing NOTION_TOKEN");
  }
  if (!existingDatabaseId && !parentPageId) {
    throw new Error("Missing NOTION_PARENT_PAGE_ID or NOTION_DATABASE_ID");
  }

  const databaseId =
    existingDatabaseId ||
    (await createLaunchDatabase({
      token,
      parentPageId,
      title
    }));

  let created = 0;
  for (const record of records) {
    await notionFetch(token, "/pages", {
      method: "POST",
      body: {
        parent: { database_id: databaseId },
        properties: pageProperties(record)
      }
    });
    created += 1;
    await sleep(350);
  }

  return {
    databaseId,
    created
  };
}

export async function createLaunchDatabase({ token, parentPageId, title }) {
  const response = await notionFetch(token, "/databases", {
    method: "POST",
    body: {
      parent: { type: "page_id", page_id: parentPageId },
      title: richText(title),
      properties: databaseProperties()
    }
  });

  return response.id;
}

export function databaseProperties() {
  return {
    "Startup Name": { title: {} },
    "Row#": { number: { format: "number" } },
    "YC Launch page link": { url: {} },
    "Description": { rich_text: {} },
    "URL": { url: {} },
    "Active Founder1": { rich_text: {} },
    "LinkedIn Active Founder1": { url: {} },
    "Active Founder2": { rich_text: {} },
    "LinkedIn Active Founder2": { url: {} },
    "Active Founder3": { rich_text: {} },
    "LinkedIn Active Founder3": { url: {} },
    "Launch video URL": { url: {} },
    "Pitch deck link": { url: {} },
    "Stage": { rich_text: {} },
    "Existing Investors": { rich_text: {} },
    "Launch Title": { rich_text: {} },
    "Tagline": { rich_text: {} },
    "Launch Date": { date: {} },
    "Votes": { number: { format: "number" } },
    "Company YC Page": { url: {} },
    "Batch": { rich_text: {} },
    "Batch Code": { rich_text: {} },
    "Industry": { rich_text: {} },
    "Tags": { multi_select: {} },
    "Status": { rich_text: {} },
    "Founded": { number: { format: "number" } },
    "Team Size": { number: { format: "number" } },
    "Location": { rich_text: {} },
    "Company LinkedIn": { url: {} },
    "Company Twitter/X": { url: {} },
    "Company GitHub": { url: {} },
    "Company Crunchbase": { url: {} },
    "Primary Group Partner": { rich_text: {} }
  };
}

export function pageProperties(record) {
  return {
    "Startup Name": titleProperty(record.startupName),
    "Row#": numberProperty(record.rowNumber),
    "YC Launch page link": urlProperty(record.ycLaunchPageLink),
    "Description": richTextProperty(record.description),
    "URL": urlProperty(record.url),
    "Active Founder1": richTextProperty(record.activeFounder1),
    "LinkedIn Active Founder1": urlProperty(record.linkedInActiveFounder1),
    "Active Founder2": richTextProperty(record.activeFounder2),
    "LinkedIn Active Founder2": urlProperty(record.linkedInActiveFounder2),
    "Active Founder3": richTextProperty(record.activeFounder3),
    "LinkedIn Active Founder3": urlProperty(record.linkedInActiveFounder3),
    "Launch video URL": urlProperty(record.launchVideoUrl),
    "Pitch deck link": urlProperty(record.pitchDeckLink),
    "Stage": richTextProperty(record.stage),
    "Existing Investors": richTextProperty(record.existingInvestors),
    "Launch Title": richTextProperty(record.launchTitle),
    "Tagline": richTextProperty(record.tagline),
    "Launch Date": dateProperty(record.launchDate),
    "Votes": numberProperty(record.votes),
    "Company YC Page": urlProperty(record.companyYcPage),
    "Batch": richTextProperty(record.batch),
    "Batch Code": richTextProperty(record.batchCode),
    "Industry": richTextProperty(record.industry),
    "Tags": multiSelectProperty(record.tags),
    "Status": richTextProperty(record.status),
    "Founded": numberProperty(record.founded),
    "Team Size": numberProperty(record.teamSize),
    "Location": richTextProperty(record.location),
    "Company LinkedIn": urlProperty(record.companyLinkedIn),
    "Company Twitter/X": urlProperty(record.companyTwitter),
    "Company GitHub": urlProperty(record.companyGitHub),
    "Company Crunchbase": urlProperty(record.companyCrunchbase),
    "Primary Group Partner": richTextProperty(record.primaryGroupPartner)
  };
}

async function notionFetch(token, path, options = {}) {
  const response = await fetch(`${NOTION_API_BASE}${path}`, {
    method: options.method || "GET",
    headers: {
      "authorization": `Bearer ${token}`,
      "content-type": "application/json",
      "notion-version": NOTION_API_VERSION
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const json = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      `Notion API ${response.status}: ${json?.message || JSON.stringify(json) || response.statusText}`
    );
  }
  return json;
}

function titleProperty(value) {
  return { title: richText(value || "Untitled") };
}

function richTextProperty(value) {
  return { rich_text: richText(value) };
}

function urlProperty(value) {
  return { url: sanitizeUrl(value) };
}

function numberProperty(value) {
  const number = Number(value);
  return { number: Number.isFinite(number) ? number : null };
}

function dateProperty(value) {
  if (!value) {
    return { date: null };
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return { date: null };
  }
  return { date: { start: date.toISOString() } };
}

function multiSelectProperty(value) {
  const names = String(value || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 20);
  return {
    multi_select: names.map((name) => ({ name: name.slice(0, 100) }))
  };
}

function richText(value) {
  const text = String(value || "").trim();
  if (!text) {
    return [];
  }
  const chunks = [];
  for (let index = 0; index < text.length; index += RICH_TEXT_CHUNK_SIZE) {
    chunks.push({
      type: "text",
      text: {
        content: text.slice(index, index + RICH_TEXT_CHUNK_SIZE)
      }
    });
  }
  return chunks;
}

function sanitizeUrl(value) {
  if (!value) {
    return null;
  }
  const text = String(value).trim();
  if (!/^https?:\/\//i.test(text)) {
    return null;
  }
  return text.slice(0, 2000);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const inputPath = process.argv[2] || "data/yc-launches.json";
  const raw = await readFile(inputPath, "utf8");
  const parsed = JSON.parse(raw);
  const records = Array.isArray(parsed) ? parsed : parsed.records;
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error(`No records found in ${inputPath}`);
  }

  const result = await publishToNotion(records);
  console.log(`Created ${result.created} rows in Notion database ${result.databaseId}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
