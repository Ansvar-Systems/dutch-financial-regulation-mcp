/**
 * AFM & DNB regelgeving webcrawler.
 *
 * Crawlt afm.nl om leidraden, beleidsregels, publicaties en handhavingsacties
 * te verzamelen en in te voeren in de SQLite-database.
 *
 * Databronnen:
 *   - AFM Leidraden: https://www.afm.nl/nl-nl/sector/themas/verplichtingen-voor-ondernemingen/beleidsuitingen/leidraden
 *   - AFM Actueel (nieuwsberichten + maatregelen): https://www.afm.nl/nl-nl/sector/actueel
 *   - AFM Boetebesluiten (PDF): https://www.afm.nl/~/profmedia/files/maatregelen/boetes/
 *   - DNB Open Boek Toezicht: https://www.dnb.nl/
 *
 * Gebruik:
 *   npx tsx scripts/ingest-afm.ts                   # volledige crawl
 *   npx tsx scripts/ingest-afm.ts --dry-run          # log zonder database-schrijfacties
 *   npx tsx scripts/ingest-afm.ts --force             # verwijder bestaande data en herbouw
 *   npx tsx scripts/ingest-afm.ts --resume            # sla reeds ingevoerde bepalingen over
 *   npx tsx scripts/ingest-afm.ts --dry-run --resume  # combineerbaar
 */

import Database from "better-sqlite3";
import { existsSync, mkdirSync, unlinkSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { SCHEMA_SQL } from "../src/db.js";
import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";

// ---------------------------------------------------------------------------
// Configuratie
// ---------------------------------------------------------------------------

const DB_PATH = process.env["AFM_DB_PATH"] ?? "data/afm.db";
const PROGRESS_PATH = join(dirname(DB_PATH), "ingest-progress.json");

const BASE_URL = "https://www.afm.nl";
const LEIDRADEN_URL = `${BASE_URL}/nl-nl/sector/themas/verplichtingen-voor-ondernemingen/beleidsuitingen/leidraden`;
const ACTUEEL_URL = `${BASE_URL}/nl-nl/sector/actueel`;

/** Minimum vertraging tussen HTTP-verzoeken in milliseconden. */
const RATE_LIMIT_MS = 1500;

/** Maximum aantal pagina's om te crawlen in de actueel-feed. */
const MAX_ACTUEEL_PAGES = 80;

/** Maximum aantal keren dat een mislukt verzoek opnieuw wordt geprobeerd. */
const MAX_RETRIES = 3;

/** Vertraging na een mislukt verzoek (verdubbelt bij elke retry). */
const RETRY_BASE_DELAY_MS = 3000;

const USER_AGENT =
  "AnsvarAFMCrawler/1.0 (+https://ansvar.eu; compliance-research)";

// ---------------------------------------------------------------------------
// CLI-vlaggen
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const FORCE = args.includes("--force");
const RESUME = args.includes("--resume");

// ---------------------------------------------------------------------------
// Voortgangsbeheer (voor --resume)
// ---------------------------------------------------------------------------

interface IngestProgress {
  crawled_urls: string[];
  last_actueel_page: number;
  completed_sourcebooks: string[];
}

function loadProgress(): IngestProgress {
  if (!RESUME || !existsSync(PROGRESS_PATH)) {
    return { crawled_urls: [], last_actueel_page: 0, completed_sourcebooks: [] };
  }
  try {
    const raw = readFileSync(PROGRESS_PATH, "utf-8");
    return JSON.parse(raw) as IngestProgress;
  } catch {
    return { crawled_urls: [], last_actueel_page: 0, completed_sourcebooks: [] };
  }
}

function saveProgress(progress: IngestProgress): void {
  if (DRY_RUN) return;
  const dir = dirname(PROGRESS_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(PROGRESS_PATH, JSON.stringify(progress, null, 2));
}

// ---------------------------------------------------------------------------
// HTTP-helper met rate limiting en retry
// ---------------------------------------------------------------------------

let lastRequestTime = 0;

async function rateLimitedFetch(url: string): Promise<Response> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < RATE_LIMIT_MS) {
    await sleep(RATE_LIMIT_MS - elapsed);
  }
  lastRequestTime = Date.now();

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "nl-NL,nl;q=0.9,en;q=0.5",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(30_000),
      });

      if (response.status === 429) {
        const retryAfter = Number(response.headers.get("Retry-After") ?? "10");
        log(`  429 ontvangen, wacht ${retryAfter}s...`);
        await sleep(retryAfter * 1000);
        continue;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} voor ${url}`);
      }

      return response;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < MAX_RETRIES - 1) {
        const delay = RETRY_BASE_DELAY_MS * 2 ** attempt;
        log(`  Poging ${attempt + 1} mislukt: ${lastError.message}. Herpoging over ${delay}ms...`);
        await sleep(delay);
      }
    }
  }

  throw new Error(
    `Alle ${MAX_RETRIES} pogingen mislukt voor ${url}: ${lastError?.message ?? "onbekende fout"}`,
  );
}

async function fetchHtml(url: string): Promise<cheerio.CheerioAPI> {
  const response = await rateLimitedFetch(url);
  const html = await response.text();
  return cheerio.load(html);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(message: string): void {
  const prefix = DRY_RUN ? "[DRY-RUN] " : "";
  const timestamp = new Date().toISOString().slice(11, 19);
  console.log(`${timestamp} ${prefix}${message}`);
}

function logError(message: string): void {
  const timestamp = new Date().toISOString().slice(11, 19);
  console.error(`${timestamp} [FOUT] ${message}`);
}

// ---------------------------------------------------------------------------
// Brondocument-definities
// ---------------------------------------------------------------------------

interface SourcebookDef {
  id: string;
  name: string;
  description: string;
}

const SOURCEBOOKS: SourcebookDef[] = [
  {
    id: "AFM-LEIDRAAD",
    name: "AFM Leidraden",
    description:
      "Leidraden van de Autoriteit Financiële Markten met praktische uitleg over de toepassing van wet- en regelgeving, waaronder de Wwft-leidraad, leidraad informatieverstrekking en leidraad duurzaamheidsclaims.",
  },
  {
    id: "AFM-BELEIDSREGEL",
    name: "AFM Beleidsregels",
    description:
      "Beleidsregels van de AFM die bindend zijn voor de AFM zelf en richting geven aan de uitleg van regelgeving, waaronder de Beleidsregel Geschiktheid en Betrouwbaarheid.",
  },
  {
    id: "AFM-PUBLICATIE",
    name: "AFM Publicaties",
    description:
      "Rapporten, marktmonitors, sectoranalyses en overige publicaties van de AFM over toezichtthema's, trends en onderzoeksbevindingen.",
  },
  {
    id: "DNB-TOEZICHT",
    name: "DNB Toezichtregelingen",
    description:
      "Toezichtregelingen van De Nederlandsche Bank op grond van de Wet op het financieel toezicht (Wft), het Besluit prudentiële regels en de Capital Requirements Regulation (CRR).",
  },
  {
    id: "DNB-GOODPRACTICE",
    name: "DNB Good Practices",
    description:
      "DNB Good Practices bieden niet-bindende richtsnoeren voor instellingen over best practices op het gebied van informatiebeveiliging, uitbesteding, risicobeheer en governance.",
  },
];

// ---------------------------------------------------------------------------
// Datatypes
// ---------------------------------------------------------------------------

interface CrawledProvision {
  sourcebook_id: string;
  reference: string;
  title: string;
  text: string;
  type: string;
  status: string;
  effective_date: string | null;
  chapter: string | null;
  section: string | null;
}

interface CrawledEnforcement {
  firm_name: string;
  reference_number: string | null;
  action_type: string;
  amount: number | null;
  date: string | null;
  summary: string;
  sourcebook_references: string | null;
}

// ---------------------------------------------------------------------------
// Crawlers
// ---------------------------------------------------------------------------

/**
 * Crawl de AFM leidraden-overzichtspagina.
 * Elke leidraad wordt als een provision ingevoerd met type "leidraad".
 */
async function crawlLeidraden(progress: IngestProgress): Promise<CrawledProvision[]> {
  log("Start crawl: AFM Leidraden...");
  const provisions: CrawledProvision[] = [];

  if (RESUME && progress.completed_sourcebooks.includes("AFM-LEIDRAAD")) {
    log("  Leidraden reeds gecrawld (--resume), overslaan.");
    return provisions;
  }

  let $: cheerio.CheerioAPI;
  try {
    $ = await fetchHtml(LEIDRADEN_URL);
  } catch (err) {
    logError(`Kan leidraden-pagina niet ophalen: ${err instanceof Error ? err.message : String(err)}`);
    return provisions;
  }

  // De leidraden-pagina bevat PDF-links in de hoofdinhoud.
  // Elk item heeft typisch een titel en een link naar een PDF.
  const links: Array<{ title: string; href: string; date: string | null }> = [];

  // Zoek alle links naar PDF-bestanden in de leidraden-sectie
  $("a[href*='/profmedia/files/']").each((_i, el) => {
    const $el = $(el);
    const href = $el.attr("href");
    const title = $el.text().trim();

    if (!href || !title) return;
    // Filter op leidraad-gerelateerde PDF's
    if (!href.includes("/leidraden/") && !href.includes("/beleidsuitingen/")) return;

    // Probeer een datum uit de omringende tekst te halen
    const parentText = $el.parent().text();
    const dateMatch = parentText.match(
      /(\b(?:januari|februari|maart|april|mei|juni|juli|augustus|september|oktober|november|december)\s+\d{4})/i,
    );

    links.push({
      title,
      href: href.startsWith("http") ? href : `${BASE_URL}${href.startsWith("/") ? "" : "/"}${href}`,
      date: dateMatch ? parseDutchDate(dateMatch[1] ?? "") : null,
    });
  });

  // Dedupliceer op href
  const seen = new Set<string>();
  const uniqueLinks = links.filter((l) => {
    if (seen.has(l.href)) return false;
    seen.add(l.href);
    return true;
  });

  log(`  ${uniqueLinks.length} unieke leidraad-PDF-links gevonden.`);

  let sectionCounter = 0;
  for (const link of uniqueLinks) {
    if (RESUME && progress.crawled_urls.includes(link.href)) {
      log(`  Overslaan (reeds gecrawld): ${link.title}`);
      continue;
    }

    sectionCounter++;
    const reference = generateLeidraadReference(link.title, sectionCounter);

    provisions.push({
      sourcebook_id: "AFM-LEIDRAAD",
      reference,
      title: link.title,
      text: buildLeidraadText(link.title, link.href),
      type: "leidraad",
      status: "van_kracht",
      effective_date: link.date,
      chapter: null,
      section: String(sectionCounter),
    });

    progress.crawled_urls.push(link.href);
    saveProgress(progress);
    log(`  [${sectionCounter}] ${link.title}`);
  }

  // Crawl individuele leidraad-detailpagina's waar mogelijk
  await crawlLeidraadDetails(provisions, progress);

  progress.completed_sourcebooks.push("AFM-LEIDRAAD");
  saveProgress(progress);
  log(`  ${provisions.length} leidraad-bepalingen verzameld.`);
  return provisions;
}

/**
 * Voor elke gecrawlde leidraad: probeer de detailpagina of PDF te bereiken
 * om aanvullende inhoud te extraheren.
 */
async function crawlLeidraadDetails(
  provisions: CrawledProvision[],
  _progress: IngestProgress,
): Promise<void> {
  // Bekende leidraad-detailpagina's met gestructureerde inhoud
  const detailPages = [
    {
      url: `${BASE_URL}/~/profmedia/files/wet-regelgeving/beleidsuitingen/leidraden/herziene-leidraad-wwft-2024.pdf`,
      sourceName: "Leidraad Wwft, Wwft BES en Sanctiewet",
      prefix: "Wwft-leidraad",
    },
    {
      url: `${BASE_URL}/~/profmedia/files/wet-regelgeving/beleidsuitingen/leidraden/leidraad-advies-en-vermogensbeheerdienstverlening.pdf`,
      sourceName: "Leidraad advies- en vermogensbeheerdienstverlening",
      prefix: "Advies-vermogensbeheer",
    },
    {
      url: `${BASE_URL}/~/profmedia/files/wet-regelgeving/beleidsuitingen/leidraden/leidraad-duurzaamheidsclaims.pdf`,
      sourceName: "Leidraad duurzaamheidsclaims",
      prefix: "Duurzaamheidsclaims",
    },
  ];

  for (const detail of detailPages) {
    // Check of er al bepalingen met dit prefix bestaan
    const existing = provisions.filter((p) => p.reference.startsWith(detail.prefix));
    if (existing.length > 0) continue;

    log(`  Detail-crawl: ${detail.sourceName} (PDF-metadata)...`);

    // PDF-inhoud kan niet in Node.js zonder extra dependencies worden geparst.
    // Voeg een samenvattende vermelding toe op basis van bekende metadata.
    provisions.push({
      sourcebook_id: "AFM-LEIDRAAD",
      reference: `${detail.prefix} — overzicht`,
      title: detail.sourceName,
      text: `${detail.sourceName}. Bron: ${detail.url}. Raadpleeg het volledige document voor de gedetailleerde bepalingen.`,
      type: "leidraad",
      status: "van_kracht",
      effective_date: null,
      chapter: null,
      section: null,
    });
  }
}

/**
 * Crawl de AFM actueel-feed voor nieuwsberichten en maatregelen.
 *
 * Artikelen van het type "Maatregel" worden verwerkt als handhavingsacties.
 * Overige artikelen met relevante inhoud worden als AFM-PUBLICATIE-bepalingen ingevoerd.
 */
async function crawlActueel(
  progress: IngestProgress,
): Promise<{ provisions: CrawledProvision[]; enforcements: CrawledEnforcement[] }> {
  log("Start crawl: AFM Actueel (nieuws + maatregelen)...");

  const provisions: CrawledProvision[] = [];
  const enforcements: CrawledEnforcement[] = [];
  const startPage = RESUME ? Math.max(1, progress.last_actueel_page) : 1;

  for (let page = startPage; page <= MAX_ACTUEEL_PAGES; page++) {
    log(`  Pagina ${page}/${MAX_ACTUEEL_PAGES}...`);

    let $: cheerio.CheerioAPI;
    try {
      // De AFM-site gebruikt een Sitecore CMS. Paginering verloopt via
      // JavaScript-rendering. Probeer de standaard querystring-patronen.
      const pageUrl = page === 1 ? ACTUEEL_URL : `${ACTUEEL_URL}?page=${page}`;
      $ = await fetchHtml(pageUrl);
    } catch (err) {
      logError(`Pagina ${page} ophalen mislukt: ${err instanceof Error ? err.message : String(err)}`);
      // Na 3 opeenvolgende lege pagina's stoppen
      break;
    }

    // Zoek artikellinks op de overzichtspagina
    const articles = extractActueelArticles($);

    if (articles.length === 0) {
      log(`  Geen artikelen gevonden op pagina ${page}, crawl beëindigd.`);
      break;
    }

    for (const article of articles) {
      if (RESUME && progress.crawled_urls.includes(article.url)) {
        continue;
      }

      // Maatregel-artikelen verwerken als handhavingsacties
      if (article.type === "Maatregel" || article.url.includes("/mr-") || article.url.includes("boete")) {
        try {
          const enforcement = await crawlEnforcementPage(article.url, article.title, article.date);
          if (enforcement) {
            enforcements.push(enforcement);
            log(`  [MAATREGEL] ${enforcement.firm_name}: ${enforcement.action_type} (${enforcement.amount ?? "n.v.t."})`);
          }
        } catch (err) {
          logError(`Maatregel-pagina ${article.url} mislukt: ${err instanceof Error ? err.message : String(err)}`);
        }
      } else {
        // Relevante nieuwsberichten als publicatie-bepalingen opnemen
        provisions.push({
          sourcebook_id: "AFM-PUBLICATIE",
          reference: buildActueelReference(article.url),
          title: article.title,
          text: article.summary || article.title,
          type: mapArticleType(article.type),
          status: "van_kracht",
          effective_date: article.date,
          chapter: null,
          section: null,
        });
      }

      progress.crawled_urls.push(article.url);
    }

    progress.last_actueel_page = page;
    saveProgress(progress);

    // Controleer of paginering beschikbaar is
    // De AFM-site rendert paginering client-side (JavaScript), dus server-side
    // crawlen heeft beperkte paginadiepte. Zodra dubbele artikelen verschijnen, stoppen.
    if (page > 1 && hasDuplicateArticles(articles, progress.crawled_urls)) {
      log(`  Dubbele artikelen gedetecteerd op pagina ${page}, paginering stopt.`);
      break;
    }
  }

  log(`  ${provisions.length} publicatie-bepalingen, ${enforcements.length} handhavingsacties verzameld.`);
  return { provisions, enforcements };
}

interface ActueelArticle {
  title: string;
  url: string;
  date: string | null;
  type: string;
  summary: string;
}

function extractActueelArticles($: cheerio.CheerioAPI): ActueelArticle[] {
  const articles: ActueelArticle[] = [];

  // De AFM actueel-pagina toont artikelen in cards/list-items.
  // Probeer meerdere CSS-selectorstrategieën.
  const selectors = [
    // Card-gebaseerde layout
    ".search-result, .news-item, .content-card, article",
    // Link-gebaseerde extractie als backup
    'a[href*="/sector/actueel/"]',
  ];

  for (const selector of selectors) {
    $(selector).each((_i, el) => {
      const $el = $(el);

      // Probeer de link te vinden
      const $link = $el.is("a") ? $el : $el.find("a").first();
      let href = $link.attr("href");
      if (!href) return;

      if (!href.startsWith("http")) {
        href = `${BASE_URL}${href.startsWith("/") ? "" : "/"}${href}`;
      }

      // Filter op actueel-artikelen
      if (!href.includes("/sector/actueel/")) return;
      // Voorkom de overzichtspagina zelf
      if (href === ACTUEEL_URL || href === `${ACTUEEL_URL}/`) return;

      const title = extractArticleTitle($el, $link);
      if (!title) return;

      // Artikeltype detecteren
      const typeText = $el.find(".content-type, .tag, .label, .article-type").first().text().trim();
      const type = typeText || detectArticleType(href, title);

      // Datum extraheren
      const dateText = $el.find("time, .date, .publish-date").first().text().trim();
      const dateAttr = $el.find("time").first().attr("datetime");
      const date = dateAttr ?? parseDateFromText(dateText);

      // Samenvatting
      const summary = $el
        .find("p, .summary, .description, .intro")
        .first()
        .text()
        .trim()
        .slice(0, 500);

      articles.push({ title, url: href, date, type, summary });
    });

    if (articles.length > 0) break;
  }

  // Dedupliceer op URL
  const seen = new Set<string>();
  return articles.filter((a) => {
    if (seen.has(a.url)) return false;
    seen.add(a.url);
    return true;
  });
}

function extractArticleTitle($el: cheerio.Cheerio<AnyNode>, $link: cheerio.Cheerio<AnyNode>): string {
  // Probeer h2, h3, dan de linktekst zelf
  const h = $el.find("h2, h3, h4").first().text().trim();
  if (h) return h;
  const linkText = $link.text().trim();
  if (linkText && linkText.length > 5) return linkText;
  const title = $link.attr("title")?.trim();
  return title ?? "";
}

function detectArticleType(url: string, title: string): string {
  if (url.includes("/mr-") || title.toLowerCase().includes("boete") || title.toLowerCase().includes("maatregel")) {
    return "Maatregel";
  }
  if (url.includes("/art-")) return "Artikel";
  if (url.includes("/sb-")) return "Nieuws";
  return "Nieuws";
}

function hasDuplicateArticles(articles: ActueelArticle[], previousUrls: string[]): boolean {
  const previousSet = new Set(previousUrls);
  const duplicateCount = articles.filter((a) => previousSet.has(a.url)).length;
  return duplicateCount > articles.length * 0.5;
}

/**
 * Crawl een individuele maatregel-pagina en extraheer de handhavingsactie.
 */
async function crawlEnforcementPage(
  url: string,
  fallbackTitle: string,
  fallbackDate: string | null,
): Promise<CrawledEnforcement | null> {
  let $: cheerio.CheerioAPI;
  try {
    $ = await fetchHtml(url);
  } catch (err) {
    logError(`Kan maatregel-pagina niet ophalen: ${url}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }

  // Inhoud van de artikelpagina extraheren
  const title = $("h1").first().text().trim() || fallbackTitle;
  const bodyText = extractArticleBody($);

  // Firmanaam extraheren uit de titel
  const firmName = extractFirmName(title, bodyText);
  if (!firmName) {
    log(`    Geen firmanaam gevonden in: ${title}`);
    return null;
  }

  // Type maatregel bepalen
  const actionType = detectActionType(title, bodyText);

  // Boetebedrag extraheren
  const amount = extractAmount(title, bodyText);

  // Datum
  const pageDate = extractPageDate($);
  const date = pageDate ?? fallbackDate;

  // Referentienummer zoeken (AFM-YYYY-NNNN patroon)
  const refMatch = bodyText.match(/(?:AFM|DNB)[-\s]?\d{4}[-\s]?\d{3,4}/i);
  const referenceNumber = refMatch ? refMatch[0] : generateRefNumber(url);

  // Gerelateerde regelgeving
  const sourcebookRefs = extractSourcebookReferences(bodyText);

  return {
    firm_name: firmName,
    reference_number: referenceNumber,
    action_type: actionType,
    amount,
    date,
    summary: bodyText.slice(0, 2000),
    sourcebook_references: sourcebookRefs,
  };
}

function extractArticleBody($: cheerio.CheerioAPI): string {
  // Probeer de hoofdinhoud te vinden
  const contentSelectors = [
    "article .content",
    ".article-content",
    ".rich-text",
    ".body-content",
    "article",
    ".main-content",
    'main [role="main"]',
    "main",
  ];

  for (const selector of contentSelectors) {
    const text = $(selector).first().text().trim();
    if (text && text.length > 100) {
      return cleanText(text);
    }
  }

  // Fallback: alle paragrafen in de body
  const paragraphs: string[] = [];
  $("main p, article p, .content p").each((_i, el) => {
    const text = $(el).text().trim();
    if (text.length > 20) paragraphs.push(text);
  });

  return paragraphs.join(" ").slice(0, 5000) || "";
}

function extractFirmName(title: string, body: string): string | null {
  // Bekende patronen in AFM-maatregelkoppen:
  //   "Boete [Firmanaam] voor ..."
  //   "Boete aan [Firmanaam] voor ..."
  //   "Maatregel [Firmanaam] wegens ..."
  //   "[Firmanaam] krijgt boete ..."
  const patterns = [
    /(?:boete|maatregel|aanwijzing|dwangsom)\s+(?:aan\s+)?(.+?)\s+(?:voor|wegens|vanwege|omdat)/i,
    /(.+?)\s+krijgt?\s+(?:boete|maatregel|aanwijzing)/i,
    /(?:boete|maatregel)\s+(.+?)$/i,
  ];

  for (const pattern of patterns) {
    const match = title.match(pattern);
    if (match?.[1]) {
      const name = match[1].trim().replace(/^['"]|['"]$/g, "");
      if (name.length > 2 && name.length < 100) return name;
    }
  }

  // Probeer firmanaam uit de eerste alinea (vaak: "De AFM heeft [Firmanaam] een ...")
  const bodyPatterns = [
    /de AFM heeft\s+(.+?)\s+een\s+(?:bestuurlijke\s+)?(?:boete|maatregel|aanwijzing)/i,
    /(?:bestuurlijke boete.*?opgelegd aan|boete.*?opgelegd aan)\s+(.+?)[\.,]/i,
  ];

  for (const pattern of bodyPatterns) {
    const match = body.match(pattern);
    if (match?.[1]) {
      const name = match[1].trim();
      if (name.length > 2 && name.length < 100) return name;
    }
  }

  return null;
}

function detectActionType(title: string, body: string): string {
  const combined = `${title} ${body}`.toLowerCase();

  if (combined.includes("bestuurlijke boete") || combined.includes("boete")) return "boete";
  if (combined.includes("last onder dwangsom")) return "last_onder_dwangsom";
  if (combined.includes("dwangsom")) return "dwangsom";
  if (combined.includes("aanwijzing")) return "aanwijzing";
  if (combined.includes("waarschuwing")) return "waarschuwing";
  if (combined.includes("publicatie")) return "publicatie";

  return "boete";
}

function extractAmount(title: string, body: string): number | null {
  const combined = `${title} ${body}`;

  // Patronen: €1.600.000 / EUR 775.000 / € 300.000 / 1,6 miljoen
  const patterns = [
    // €1.600.000 of EUR 1.600.000
    /(?:€|EUR)\s*([\d.]+(?:,\d+)?)/gi,
    // X miljoen / X miljard
    /([\d,]+)\s*miljoen/gi,
    /([\d,]+)\s*miljard/gi,
  ];

  let highestAmount = 0;

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(combined)) !== null) {
      const rawValue = match[1];
      if (!rawValue) continue;

      let amount: number;
      if (combined.slice(match.index).includes("miljard")) {
        amount = parseFloat(rawValue.replace(/\./g, "").replace(",", ".")) * 1_000_000_000;
      } else if (combined.slice(match.index).includes("miljoen")) {
        amount = parseFloat(rawValue.replace(/\./g, "").replace(",", ".")) * 1_000_000;
      } else {
        // Nederlands getalformaat: punten als duizendtallen, komma als decimaal
        amount = parseFloat(rawValue.replace(/\./g, "").replace(",", "."));
      }

      if (!isNaN(amount) && amount > highestAmount) {
        highestAmount = amount;
      }
    }
  }

  return highestAmount > 0 ? highestAmount : null;
}

function extractPageDate($: cheerio.CheerioAPI): string | null {
  // Zoek datum in meta-tags of time-elementen
  const metaDate =
    $('meta[property="article:published_time"]').attr("content") ??
    $('meta[name="date"]').attr("content") ??
    $('meta[name="DC.date"]').attr("content");

  if (metaDate) {
    const parsed = metaDate.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(parsed)) return parsed;
  }

  const timeEl = $("time[datetime]").first().attr("datetime");
  if (timeEl) {
    const parsed = timeEl.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(parsed)) return parsed;
  }

  // Probeer datum uit de URL: /actueel/YYYY/mmm/
  return null;
}

function extractSourcebookReferences(text: string): string | null {
  const refs: string[] = [];

  // Zoek naar verwijzingen naar bekende wetten en regelgeving
  const patterns = [
    /(?:artikel\s+[\d:]+\s+)?Wft/gi,
    /(?:artikel\s+[\d:]+\s+)?Wwft/gi,
    /(?:artikel\s+[\d:]+\s+)?BGfo/gi,
    /MiFID\s*(?:II)?/gi,
    /CRR/g,
    /CRD\s*(?:IV|V|VI)?/gi,
    /DORA/g,
    /Sanctiewet(?:\s+\d+)?/gi,
    /PRIIPs/gi,
    /SFDR/gi,
    /Solvency\s*(?:II)?/gi,
    /AIFMD/gi,
    /UCITS/gi,
  ];

  for (const pattern of patterns) {
    const matches = text.match(pattern);
    if (matches) {
      for (const m of matches) {
        const normalized = m.trim();
        if (!refs.includes(normalized)) refs.push(normalized);
      }
    }
  }

  return refs.length > 0 ? refs.join(", ") : null;
}

// ---------------------------------------------------------------------------
// Hulpfuncties
// ---------------------------------------------------------------------------

function generateLeidraadReference(title: string, index: number): string {
  // Maak een korte referentie op basis van de titel
  const shortened = title
    .replace(/^Leidraad\s+/i, "")
    .replace(/^Brochure\s+/i, "")
    .replace(/^Handboek\s+/i, "")
    .replace(/^Beoordelingskader\s+/i, "")
    .replace(/^Annex\s+/i, "Annex ")
    .slice(0, 60)
    .trim();

  return `Leidraad ${index}: ${shortened}`;
}

function buildLeidraadText(title: string, pdfUrl: string): string {
  return `${title}. Dit document is beschikbaar als PDF: ${pdfUrl}. Raadpleeg het volledige document voor de gedetailleerde bepalingen en vereisten.`;
}

function buildActueelReference(url: string): string {
  // URL: .../actueel/YYYY/mmm/slug → ref: "AFM-YYYY-mmm-slug"
  const match = url.match(/actueel\/(\d{4})\/([a-z]+)\/(.+?)(?:\?|#|$)/);
  if (match) {
    return `AFM-${match[1]}-${match[2]}-${match[3]}`;
  }
  // Fallback
  const slug = url.split("/").pop() ?? "onbekend";
  return `AFM-actueel-${slug}`;
}

function mapArticleType(type: string): string {
  const typeMap: Record<string, string> = {
    Nieuws: "nieuwsbericht",
    Artikel: "artikel",
    Maatregel: "maatregel",
    Publicatie: "publicatie",
    Rapport: "rapport",
  };
  return typeMap[type] ?? "publicatie";
}

function generateRefNumber(url: string): string {
  // Genereer referentienummer op basis van URL-componenten
  const match = url.match(/(\d{4})\/([a-z]+)\/(.+?)(?:\?|#|$)/);
  if (match) {
    const year = match[1];
    const slug = (match[3] ?? "").replace(/[^a-z0-9]/g, "").slice(0, 8).toUpperCase();
    return `AFM-${year}-${slug}`;
  }
  return `AFM-${Date.now()}`;
}

const DUTCH_MONTHS: Record<string, string> = {
  januari: "01",
  februari: "02",
  maart: "03",
  april: "04",
  mei: "05",
  juni: "06",
  juli: "07",
  augustus: "08",
  september: "09",
  oktober: "10",
  november: "11",
  december: "12",
  // Afkortingen uit URL-slugs
  jan: "01",
  feb: "02",
  mrt: "03",
  apr: "04",
  jun: "06",
  jul: "07",
  aug: "08",
  sep: "09",
  okt: "10",
  nov: "11",
  dec: "12",
};

function parseDutchDate(text: string): string | null {
  // "september 2016" → "2016-09-01"
  const match = text.match(
    /(?:(\d{1,2})\s+)?(\w+)\s+(\d{4})/i,
  );
  if (!match) return null;

  const day = match[1] ?? "01";
  const monthStr = (match[2] ?? "").toLowerCase();
  const year = match[3];
  const month = DUTCH_MONTHS[monthStr];

  if (!month || !year) return null;
  return `${year}-${month}-${day.padStart(2, "0")}`;
}

function parseDateFromText(text: string): string | null {
  if (!text) return null;

  // DD/MM/YY formaat (bijv. "09/03/26")
  const slashMatch = text.match(/(\d{2})\/(\d{2})\/(\d{2,4})/);
  if (slashMatch) {
    const day = slashMatch[1];
    const month = slashMatch[2];
    let year = slashMatch[3];
    if (year && year.length === 2) {
      year = `20${year}`;
    }
    return `${year}-${month}-${day}`;
  }

  // DD maand YYYY
  return parseDutchDate(text);
}

function cleanText(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---------------------------------------------------------------------------
// Database-schrijfacties
// ---------------------------------------------------------------------------

function initDatabase(): Database.Database {
  const dir = dirname(DB_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  if (FORCE && existsSync(DB_PATH)) {
    unlinkSync(DB_PATH);
    log(`Bestaande database verwijderd: ${DB_PATH}`);
  }

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA_SQL);

  return db;
}

function insertSourcebooks(db: Database.Database): void {
  const stmt = db.prepare(
    "INSERT OR IGNORE INTO sourcebooks (id, name, description) VALUES (?, ?, ?)",
  );

  const insertAll = db.transaction(() => {
    for (const sb of SOURCEBOOKS) {
      stmt.run(sb.id, sb.name, sb.description);
    }
  });

  insertAll();
  log(`${SOURCEBOOKS.length} brondocumenten ingevoerd/bijgewerkt.`);
}

function insertProvisions(db: Database.Database, provisions: CrawledProvision[]): number {
  if (provisions.length === 0) return 0;

  const checkExisting = db.prepare(
    "SELECT id FROM provisions WHERE sourcebook_id = ? AND reference = ? LIMIT 1",
  );

  const insertStmt = db.prepare(`
    INSERT INTO provisions (sourcebook_id, reference, title, text, type, status, effective_date, chapter, section)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let inserted = 0;

  const insertAll = db.transaction(() => {
    for (const p of provisions) {
      // Bij --resume: sla bestaande bepalingen over
      if (RESUME) {
        const existing = checkExisting.get(p.sourcebook_id, p.reference) as
          | { id: number }
          | undefined;
        if (existing) continue;
      }

      insertStmt.run(
        p.sourcebook_id,
        p.reference,
        p.title,
        p.text,
        p.type,
        p.status,
        p.effective_date,
        p.chapter,
        p.section,
      );
      inserted++;
    }
  });

  insertAll();
  return inserted;
}

function insertEnforcements(db: Database.Database, enforcements: CrawledEnforcement[]): number {
  if (enforcements.length === 0) return 0;

  const checkExisting = db.prepare(
    "SELECT id FROM enforcement_actions WHERE reference_number = ? LIMIT 1",
  );

  const insertStmt = db.prepare(`
    INSERT INTO enforcement_actions (firm_name, reference_number, action_type, amount, date, summary, sourcebook_references)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  let inserted = 0;

  const insertAll = db.transaction(() => {
    for (const e of enforcements) {
      // Bij --resume: sla bestaande acties over
      if (RESUME && e.reference_number) {
        const existing = checkExisting.get(e.reference_number) as
          | { id: number }
          | undefined;
        if (existing) continue;
      }

      insertStmt.run(
        e.firm_name,
        e.reference_number,
        e.action_type,
        e.amount,
        e.date,
        e.summary,
        e.sourcebook_references,
      );
      inserted++;
    }
  });

  insertAll();
  return inserted;
}

// ---------------------------------------------------------------------------
// Hoofdprogramma
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  log("=== AFM Ingest Crawler gestart ===");
  log(`Database: ${DB_PATH}`);
  log(`Modus: ${DRY_RUN ? "dry-run" : "live"} | ${FORCE ? "force" : "incrementeel"} | ${RESUME ? "resume" : "vers"}`);

  const progress = loadProgress();

  // Fase 1: Leidraden crawlen
  const leidraadProvisions = await crawlLeidraden(progress);

  // Fase 2: Actueel-feed crawlen (nieuws + maatregelen)
  const { provisions: actueelProvisions, enforcements } = await crawlActueel(progress);

  // Alle bepalingen samenvoegen
  const allProvisions = [...leidraadProvisions, ...actueelProvisions];

  log(`\nTotaal verzameld:`);
  log(`  Bepalingen:        ${allProvisions.length}`);
  log(`  Handhavingsacties: ${enforcements.length}`);

  if (DRY_RUN) {
    log("\n[DRY-RUN] Geen database-wijzigingen uitgevoerd.");

    // Log een voorbeeld van verzamelde data
    if (allProvisions.length > 0) {
      log("\nVoorbeeld bepaling:");
      const sample = allProvisions[0]!;
      log(`  Bron: ${sample.sourcebook_id}`);
      log(`  Ref:  ${sample.reference}`);
      log(`  Titel: ${sample.title}`);
      log(`  Tekst: ${sample.text.slice(0, 120)}...`);
    }

    if (enforcements.length > 0) {
      log("\nVoorbeeld handhavingsactie:");
      const sample = enforcements[0]!;
      log(`  Firma: ${sample.firm_name}`);
      log(`  Type:  ${sample.action_type}`);
      log(`  Bedrag: ${sample.amount ?? "n.v.t."}`);
    }

    log("\nKlaar (dry-run).");
    return;
  }

  // Database initialiseren en vullen
  const db = initDatabase();

  try {
    insertSourcebooks(db);

    const provInserted = insertProvisions(db, allProvisions);
    log(`${provInserted} bepalingen ingevoerd.`);

    const enfInserted = insertEnforcements(db, enforcements);
    log(`${enfInserted} handhavingsacties ingevoerd.`);

    // Samenvatting
    const provisionCount = (
      db.prepare("SELECT count(*) as cnt FROM provisions").get() as { cnt: number }
    ).cnt;
    const sourcebookCount = (
      db.prepare("SELECT count(*) as cnt FROM sourcebooks").get() as { cnt: number }
    ).cnt;
    const enforcementCount = (
      db.prepare("SELECT count(*) as cnt FROM enforcement_actions").get() as { cnt: number }
    ).cnt;
    const ftsCount = (
      db.prepare("SELECT count(*) as cnt FROM provisions_fts").get() as { cnt: number }
    ).cnt;

    log(`\nDatabaseoverzicht:`);
    log(`  Brondocumenten:       ${sourcebookCount}`);
    log(`  Bepalingen:           ${provisionCount}`);
    log(`  Handhavingsacties:    ${enforcementCount}`);
    log(`  FTS-vermeldingen:     ${ftsCount}`);
  } finally {
    db.close();
  }

  // Voortgang opruimen na succesvolle voltooiing
  if (existsSync(PROGRESS_PATH)) {
    unlinkSync(PROGRESS_PATH);
    log("Voortgangsbestand opgeruimd.");
  }

  log(`\nKlaar. Database beschikbaar op ${DB_PATH}`);
}

main().catch((err) => {
  logError(`Fatale fout: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
