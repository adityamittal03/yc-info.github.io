import { scrapeLaunches } from "./yc.js";
import { writeExports } from "./exporters.js";
import { publishToNotion } from "./notion.js";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const pages = args.all ? Infinity : Number(args.pages || 1);
  const hitsPerPage = Number(args.hitsPerPage || 100);
  const concurrency = Number(args.concurrency || 4);
  const limit = Number(args.limit || 0);
  const basename = args.basename || "yc-launches";

  const { records, meta } = await scrapeLaunches({
    pages,
    hitsPerPage,
    concurrency,
    limit,
    includeLaunchDetails: !args.skipLaunchDetails,
    includeCompanyDetails: !args.skipCompanyDetails,
    onProgress(event) {
      const total = event.total === Infinity ? "all" : event.total || "?";
      console.error(`[${event.phase}] ${event.current}/${total} ${event.message || ""}`);
    }
  });

  const paths = await writeExports(records, { meta, basename });
  console.log(JSON.stringify({ meta, paths }, null, 2));

  if (args.notion) {
    const result = await publishToNotion(records, {
      title: args.notionTitle || process.env.NOTION_DATABASE_TITLE
    });
    console.log(`Created ${result.created} rows in Notion database ${result.databaseId}`);
  }
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      continue;
    }
    const key = toCamelCase(arg.slice(2));
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}
