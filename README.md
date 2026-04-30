# YC Launches Scraper

Scrape companies from [Launch YC](https://www.ycombinator.com/launches/), enrich each launch with its YC company profile, review the data in a local website, and export CSV/Markdown/JSON.

## Run Locally

```bash
npm run dev
```

Open `http://localhost:3000`, choose the number of pages, and click `Scrape`.

For deployed environments, use:

```bash
npm start
```

The YC endpoint currently exposes up to 100 launches per page and reports 10 reachable pages at that page size, even though it reports more total hits. In practice that means the public pagination currently returns the latest 1000 launches.

## CLI

```bash
npm run scrape -- --pages 1
npm run scrape -- --all
npm run scrape -- --pages 1 --limit 25
```

Outputs are written to:

- `data/yc-launches.json`
- `exports/yc-launches.csv`
- `exports/yc-launches.md`

## Notion Export

Create a Notion integration, share the target parent page with it, then set:

```bash
export NOTION_TOKEN=secret_xxx
export NOTION_PARENT_PAGE_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
export NOTION_DATABASE_TITLE="YC Launches"
```

Then run:

```bash
npm run notion
```

If you want to append to an existing database instead of creating a new database, set `NOTION_DATABASE_ID`.

## Fields

The table includes the requested fields:

- `Row#`
- `YC Launch page link`
- `Startup Name`
- `Description`
- `URL`
- `Active Founder1`, `LinkedIn Active Founder1`
- `Active Founder2`, `LinkedIn Active Founder2`
- `Active Founder3`, `LinkedIn Active Founder3`
- `Launch video URL`
- `Pitch deck link`

It also includes extra fields when public data is available: `Stage`, `Existing Investors`, `Batch`, `Industry`, `Tags`, `Status`, `Founded`, `Team Size`, `Location`, social links, vote count, launch date, and primary YC group partner.

`Launch video URL` and `Pitch deck link` are heuristic fields because YC does not expose them as dedicated JSON properties. The scraper extracts likely video and pitch deck links from the launch post body.
