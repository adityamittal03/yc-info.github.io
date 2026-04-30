import { setTimeout as delay } from "node:timers/promises";

export const YC_BASE_URL = "https://www.ycombinator.com";
export const DEFAULT_HITS_PER_PAGE = 100;
export const DEFAULT_CONCURRENCY = 4;

const DEFAULT_HEADERS = {
  "accept": "*/*",
  "user-agent": "curl/8.7.1"
};

const VIDEO_HOST_PATTERNS = [
  "youtube.com",
  "youtu.be",
  "vimeo.com",
  "loom.com",
  "wistia.com",
  "vidyard.com",
  "streamable.com"
];

const PITCH_HOST_PATTERNS = [
  "docsend.com",
  "pitch.com",
  "gamma.app",
  "canva.com",
  "slideshare.net"
];

export async function scrapeLaunches(options = {}) {
  const pages = normalizePages(options.pages ?? 1);
  const hitsPerPage = clampInteger(options.hitsPerPage, DEFAULT_HITS_PER_PAGE, 1, 100);
  const concurrency = clampInteger(options.concurrency, DEFAULT_CONCURRENCY, 1, 10);
  const limit = clampInteger(options.limit, 0, 0, 10000);
  const delayMs = clampInteger(options.delayMs, 80, 0, 5000);
  const includeLaunchDetails = options.includeLaunchDetails ?? true;
  const includeCompanyDetails = options.includeCompanyDetails ?? true;
  const onProgress = options.onProgress;

  const index = await fetchLaunchIndex({
    pages,
    hitsPerPage,
    limit,
    delayMs,
    onProgress
  });

  const hits = limit > 0 ? index.hits.slice(0, limit) : index.hits;
  onProgress?.({
    phase: "enrich",
    current: 0,
    total: hits.length,
    message: "Fetching launch detail and company profile pages"
  });

  const records = await mapLimit(hits, concurrency, async (hit, indexPosition) => {
    const launchUrl = absoluteUrl(hit.search_path || `/launches/${hit.slug}`);
    const companySlug = hit.company?.slug || null;
    const companyUrl = companySlug ? `${YC_BASE_URL}/companies/${companySlug}` : null;

    const [launchDetail, companyProfile] = await Promise.all([
      includeLaunchDetails ? fetchLaunchDetail(launchUrl).catch(toFetchError) : null,
      includeCompanyDetails && companyUrl
        ? fetchCompanyProfile(companyUrl).catch(toFetchError)
        : null
    ]);

    const record = buildRecord({
      rowNumber: indexPosition + 1,
      hit,
      launch: isFetchError(launchDetail) ? null : launchDetail,
      company: isFetchError(companyProfile) ? null : companyProfile,
      launchError: isFetchError(launchDetail) ? launchDetail.message : null,
      companyError: isFetchError(companyProfile) ? companyProfile.message : null
    });

    onProgress?.({
      phase: "enrich",
      current: indexPosition + 1,
      total: hits.length,
      message: record.startupName
    });

    return record;
  });

  return {
    records,
    meta: {
      scrapedAt: new Date().toISOString(),
      source: `${YC_BASE_URL}/launches/`,
      requestedPages: pages === Infinity ? "all" : pages,
      hitsPerPage: index.meta.hitsPerPage,
      reachablePages: index.meta.nbPages,
      totalPublicHits: index.meta.nbHits,
      returnedHits: records.length,
      note:
        index.meta.nbHits > index.meta.nbPages * index.meta.hitsPerPage
          ? `YC reports ${index.meta.nbHits} hits, but the public endpoint currently exposes ${index.meta.nbPages * index.meta.hitsPerPage} through pagination.`
          : null
    }
  };
}

export async function fetchLaunchIndex(options = {}) {
  const pages = normalizePages(options.pages ?? 1);
  const hitsPerPage = clampInteger(options.hitsPerPage, DEFAULT_HITS_PER_PAGE, 1, 100);
  const limit = clampInteger(options.limit, 0, 0, 10000);
  const delayMs = clampInteger(options.delayMs, 80, 0, 5000);
  const onProgress = options.onProgress;

  const hits = [];
  let page = 0;
  let pagesFetched = 0;
  let nbPages = null;
  let nbHits = null;
  let actualHitsPerPage = hitsPerPage;
  const requestedPages = pages;

  while (page < requestedPages) {
    const url = new URL(`${YC_BASE_URL}/launches/`);
    url.searchParams.set("page", String(page));
    url.searchParams.set("hitsPerPage", String(hitsPerPage));

    onProgress?.({
      phase: "index",
      current: page + 1,
      total: nbPages || requestedPages,
      message: url.toString()
    });

    const payload = await fetchJson(url);
    pagesFetched += 1;
    nbPages = payload.nbPages ?? nbPages ?? page + 1;
    nbHits = payload.nbHits ?? nbHits ?? payload.hits?.length ?? 0;
    actualHitsPerPage = payload.hitsPerPage ?? actualHitsPerPage;
    hits.push(...(payload.hits || []));

    if (limit > 0 && hits.length >= limit) {
      break;
    }

    page += 1;
    if (page >= nbPages) {
      break;
    }
    if (delayMs > 0) {
      await delay(delayMs);
    }
  }

  return {
    hits: limit > 0 ? hits.slice(0, limit) : hits,
    meta: {
      nbPages: nbPages || page,
      nbHits: nbHits || hits.length,
      hitsPerPage: actualHitsPerPage,
      pagesFetched
    }
  };
}

export async function fetchLaunchDetail(urlOrSlug) {
  const url = urlOrSlug.startsWith("http")
    ? urlOrSlug
    : `${YC_BASE_URL}/launches/${urlOrSlug}`;
  return fetchJson(url);
}

export async function fetchCompanyProfile(urlOrSlug) {
  const url = urlOrSlug.startsWith("http")
    ? urlOrSlug
    : `${YC_BASE_URL}/companies/${urlOrSlug}`;
  const html = await fetchText(url);
  return parseCompanyProfile(html);
}

export function parseCompanyProfile(html) {
  const dataPage = extractDataPage(html);
  const company = dataPage?.props?.company;
  if (!company) {
    throw new Error("Could not find company payload in YC company page");
  }
  return company;
}

export function buildRecord(input) {
  const { rowNumber, hit, launch, company, launchError, companyError } = input;
  const hitCompany = hit.company || {};
  const launchCompany = launch?.company || {};
  const companySlug = company?.slug || launchCompany.slug || hitCompany.slug;
  const launchBody = launch?.body || "";
  const bodyLinks = extractLinks(launchBody);
  const activeFounders = getActiveFounders(company?.founders || []);
  const description =
    normalizeWhitespace(company?.long_description) ||
    normalizeWhitespace(launch?.tagline) ||
    normalizeWhitespace(hit.tagline) ||
    truncate(markdownToText(launchBody), 1800);

  const freeFormStage = extractAnswer(company, ["stage"]);
  const investors = extractAnswer(company, [
    "existing investor",
    "investor",
    "funding",
    "backer"
  ]);

  const record = {
    rowNumber,
    ycLaunchPageLink: launch?.url || absoluteUrl(hit.search_path || `/launches/${hit.slug}`),
    startupName: company?.name || launchCompany.name || hitCompany.name || hit.title || null,
    description: description || null,
    url: normalizeUrl(company?.website || launchCompany.url || hitCompany.url),
    activeFounder1: activeFounders[0]?.full_name || null,
    linkedInActiveFounder1: normalizeLinkedIn(activeFounders[0]?.linkedin_url),
    activeFounder2: activeFounders[1]?.full_name || null,
    linkedInActiveFounder2: normalizeLinkedIn(activeFounders[1]?.linkedin_url),
    activeFounder3: activeFounders[2]?.full_name || null,
    linkedInActiveFounder3: normalizeLinkedIn(activeFounders[2]?.linkedin_url),
    launchVideoUrl: extractVideoUrl(launchBody) || company?.dday_video_url || company?.app_video_url || null,
    pitchDeckLink: extractPitchDeckUrl(launchBody) || null,
    stage: freeFormStage || null,
    existingInvestors: investors || null,
    launchTitle: launch?.title || hit.title || null,
    tagline: launch?.tagline || hit.tagline || null,
    launchDate: launch?.created_at || hit.created_at || null,
    votes: numberOrNull(launch?.total_vote_count ?? hit.total_vote_count),
    companyYcPage: company?.ycdc_url || (companySlug ? `${YC_BASE_URL}/companies/${companySlug}` : null),
    batch: company?.batch_name || hitCompany.batch || launchCompany.batch || null,
    batchCode: company?.batch || null,
    industry: hitCompany.industry || launchCompany.industry || null,
    tags: listToText(company?.tags || launchCompany.tags || hitCompany.tags),
    status: company?.ycdc_status || null,
    founded: numberOrNull(company?.year_founded),
    teamSize: numberOrNull(company?.team_size),
    location: company?.location || locationFromCompany(company),
    companyLinkedIn: normalizeLinkedIn(company?.linkedin_url),
    companyTwitter: normalizeUrl(company?.twitter_url),
    companyGitHub: normalizeUrl(company?.github_url),
    companyCrunchbase: normalizeUrl(company?.cb_url),
    primaryGroupPartner: company?.primary_group_partner?.full_name || null,
    ddayVideoUrl: company?.dday_video_url || null,
    appVideoUrl: company?.app_video_url || null,
    launchBodyText: truncate(markdownToText(launchBody), 8000) || null,
    extractedLinks: listToText(bodyLinks),
    logoUrl: company?.small_logo_url || launchCompany.logo || hitCompany.logo || null,
    launchFetchError: launchError || null,
    companyFetchError: companyError || null
  };

  return record;
}

export function extractLinks(markdown) {
  if (!markdown) {
    return [];
  }

  const urls = [];
  const markdownLinkPattern = /!?\[[^\]]*]\(([^)\s]+(?:\s+"[^"]*")?)\)/g;
  const rawUrlPattern = /https?:\/\/[^\s<>"'`)\]]+/g;

  let match;
  while ((match = markdownLinkPattern.exec(markdown))) {
    const value = match[1].split(/\s+"/)[0];
    urls.push(cleanUrl(value));
  }
  while ((match = rawUrlPattern.exec(markdown))) {
    urls.push(cleanUrl(match[0]));
  }

  return unique(urls.filter(Boolean));
}

export function extractVideoUrl(text) {
  return extractContextualUrl(text, (url, context) => {
    const lowerUrl = url.toLowerCase();
    return (
      VIDEO_HOST_PATTERNS.some((pattern) => lowerUrl.includes(pattern)) ||
      context.includes("launch video") ||
      context.includes("demo video") ||
      context.includes("watch our video")
    );
  });
}

export function extractPitchDeckUrl(text) {
  return extractContextualUrl(text, (url, context) => {
    const lowerUrl = url.toLowerCase();
    return (
      PITCH_HOST_PATTERNS.some((pattern) => lowerUrl.includes(pattern)) ||
      context.includes("pitch deck") ||
      context.includes("deck link") ||
      context.includes("our deck") ||
      lowerUrl.endsWith(".pdf")
    );
  });
}

export function markdownToText(markdown) {
  if (!markdown) {
    return "";
  }
  return normalizeWhitespace(
    markdown
      .replace(/!\[[^\]]*]\([^)]*\)/g, "")
      .replace(/\[([^\]]+)]\(([^)]+)\)/g, "$1 ($2)")
      .replace(/`{1,3}([^`]+)`{1,3}/g, "$1")
      .replace(/[*_~>#-]+/g, " ")
      .replace(/\n{2,}/g, "\n")
  );
}

export function extractDataPage(html) {
  const match = html.match(/data-page="([^"]+)"/);
  if (!match) {
    return null;
  }
  return JSON.parse(decodeHtmlEntities(match[1]));
}

export function decodeHtmlEntities(value) {
  const named = {
    amp: "&",
    quot: "\"",
    apos: "'",
    lt: "<",
    gt: ">",
    nbsp: " "
  };

  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (entity, name) => {
    if (name.startsWith("#x")) {
      return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
    }
    if (name.startsWith("#")) {
      return String.fromCodePoint(Number.parseInt(name.slice(1), 10));
    }
    return named[name] ?? entity;
  });
}

async function fetchJson(url) {
  const text = await fetchText(url);
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Expected JSON from ${url}: ${error.message}`);
  }
}

async function fetchText(url, options = {}) {
  const { retries = 2, retryDelayMs = 500 } = options;
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, { headers: DEFAULT_HEADERS });
      if (response.ok) {
        return response.text();
      }
      const body = await response.text().catch(() => "");
      const retryable = response.status === 429 || response.status >= 500;
      const message = `HTTP ${response.status} for ${url}${body ? `: ${truncate(body, 180)}` : ""}`;
      const error = new Error(message);
      error.retryable = retryable;
      throw error;
    } catch (error) {
      lastError = error;
      if (error.retryable === false || attempt === retries) {
        throw error;
      }
    }
    await delay(retryDelayMs * (attempt + 1));
  }

  throw lastError || new Error(`Failed fetching ${url}`);
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const safeLimit = clampInteger(limit, DEFAULT_CONCURRENCY, 1, 10);
  const workerCount = Math.max(1, Math.min(safeLimit, items.length || 1));

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

function extractContextualUrl(text, predicate) {
  if (!text) {
    return null;
  }
  const urls = extractLinks(text);
  for (const url of urls) {
    const index = text.indexOf(url);
    const contextStart = Math.max(0, index - 90);
    const contextEnd = index >= 0 ? index + url.length + 90 : text.length;
    const context = text.slice(contextStart, contextEnd).toLowerCase();
    if (predicate(url, context)) {
      return url;
    }
  }
  return null;
}

function extractAnswer(company, needles) {
  if (!company) {
    return null;
  }
  const answers = [
    ...(company.free_response_question_answers || []),
    ...(company.app_answers || [])
  ];
  for (const item of answers) {
    const question = String(
      item.question ||
        item.prompt ||
        item.label ||
        item.title ||
        item.name ||
        item.free_response_question ||
        ""
    ).toLowerCase();
    const answer = normalizeWhitespace(
      item.answer ||
        item.response ||
        item.value ||
        item.text ||
        item.body ||
        ""
    );
    if (!answer) {
      continue;
    }
    if (needles.some((needle) => question.includes(needle))) {
      return answer;
    }
  }
  return null;
}

function getActiveFounders(founders) {
  const active = founders.filter((founder) => founder.is_active !== false);
  return (active.length > 0 ? active : founders).slice(0, 3);
}

function normalizeLinkedIn(url) {
  if (!url) {
    return null;
  }
  return normalizeUrl(url);
}

function normalizePages(value) {
  if (value === "all" || value === Infinity) {
    return Infinity;
  }
  return clampInteger(value, 1, 1, 50);
}

function clampInteger(value, fallback, min, max) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, number));
}

function normalizeUrl(url) {
  if (!url) {
    return null;
  }
  const trimmed = String(url).trim();
  if (!trimmed) {
    return null;
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  if (/^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return trimmed;
}

function absoluteUrl(url) {
  if (!url) {
    return null;
  }
  if (url.startsWith("http")) {
    return url;
  }
  return new URL(url, YC_BASE_URL).toString();
}

function cleanUrl(url) {
  if (!url) {
    return null;
  }
  return absoluteUrl(
    url
      .replace(/&amp;/g, "&")
      .replace(/[.,;:!?]+$/g, "")
      .replace(/\)+$/g, "")
      .trim()
  );
}

function unique(values) {
  return Array.from(new Set(values));
}

function listToText(value) {
  if (!value) {
    return "";
  }
  if (Array.isArray(value)) {
    return value.filter(Boolean).join(", ");
  }
  return String(value);
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function locationFromCompany(company) {
  if (!company) {
    return null;
  }
  return [company.city, company.country].filter(Boolean).join(", ") || null;
}

function normalizeWhitespace(value) {
  if (!value) {
    return "";
  }
  return String(value).replace(/\s+/g, " ").trim();
}

function truncate(value, maxLength) {
  const normalized = normalizeWhitespace(value);
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1).trim()}...`;
}

function toFetchError(error) {
  return {
    __fetchError: true,
    message: error instanceof Error ? error.message : String(error)
  };
}

function isFetchError(value) {
  return Boolean(value?.__fetchError);
}
