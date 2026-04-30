import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRecord,
  decodeHtmlEntities,
  extractDataPage,
  extractLinks,
  extractPitchDeckUrl,
  extractVideoUrl,
  markdownToText
} from "../src/yc.js";

test("decodeHtmlEntities decodes data-page entities", () => {
  assert.equal(
    decodeHtmlEntities("{&quot;name&quot;:&quot;A &amp; B&#x27;s&quot;}"),
    "{\"name\":\"A & B's\"}"
  );
});

test("extractDataPage parses YC embedded payload", () => {
  const html = '<div data-page="{&quot;props&quot;:{&quot;company&quot;:{&quot;name&quot;:&quot;Acme&quot;}}}"></div>';
  assert.equal(extractDataPage(html).props.company.name, "Acme");
});

test("extractLinks finds markdown and raw urls once", () => {
  const body = "Watch [demo](https://youtu.be/abc). Also https://example.com/test.";
  assert.deepEqual(extractLinks(body), ["https://youtu.be/abc", "https://example.com/test"]);
});

test("extractVideoUrl prefers video domains", () => {
  assert.equal(
    extractVideoUrl("Checkout our launch video here: https://youtu.be/092jdOwgOx4"),
    "https://youtu.be/092jdOwgOx4"
  );
});

test("extractPitchDeckUrl detects contextual deck links", () => {
  assert.equal(
    extractPitchDeckUrl("Pitch deck: https://docs.google.com/presentation/d/abc"),
    "https://docs.google.com/presentation/d/abc"
  );
});

test("markdownToText removes basic markdown", () => {
  assert.equal(markdownToText("## Hello\n\n[Site](https://x.test) **now**"), "Hello Site (https://x.test) now");
});

test("buildRecord normalizes urls and active founders", () => {
  const record = buildRecord({
    rowNumber: 1,
    hit: {
      title: "Acme launch",
      tagline: "Builds widgets",
      slug: "abc-acme-launch",
      search_path: "/launches/abc-acme-launch",
      total_vote_count: 7,
      company: {
        name: "Acme",
        url: "acme.test",
        slug: "acme",
        tags: ["AI"],
        batch: "Summer 2025",
        industry: "B2B"
      }
    },
    launch: null,
    company: {
      name: "Acme",
      slug: "acme",
      website: "acme.test",
      long_description: "Acme makes testing easier.",
      ycdc_status: "Active",
      github_url: "github.com/acme",
      founders: [
        { is_active: false, full_name: "Inactive Founder", linkedin_url: "linkedin.com/in/inactive" },
        { is_active: true, full_name: "Active Founder", linkedin_url: "linkedin.com/in/active" }
      ]
    },
    launchError: null,
    companyError: null
  });

  assert.equal(record.url, "https://acme.test");
  assert.equal(record.companyGitHub, "https://github.com/acme");
  assert.equal(record.activeFounder1, "Active Founder");
  assert.equal(record.linkedInActiveFounder1, "https://linkedin.com/in/active");
});
