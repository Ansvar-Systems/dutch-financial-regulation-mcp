/**
 * Laad de AFM/DNB-database met voorbeeldbepalingen voor testdoeleinden.
 *
 * Voegt bekende bepalingen in uit AFM Leidraden, AFM Beleidsregels,
 * DNB Toezichtregelingen en DNB Good Practices zodat MCP-tools getest
 * kunnen worden zonder een volledige webcrawl uit te voeren.
 *
 * Gebruik:
 *   npx tsx scripts/seed-sample.ts
 *   npx tsx scripts/seed-sample.ts --force   # verwijder en hermaak database
 */

import Database from "better-sqlite3";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { SCHEMA_SQL } from "../src/db.js";

const DB_PATH = process.env["AFM_DB_PATH"] ?? "data/afm.db";
const force = process.argv.includes("--force");

// Database initialiseren

const dir = dirname(DB_PATH);
if (!existsSync(dir)) {
  mkdirSync(dir, { recursive: true });
}

if (force && existsSync(DB_PATH)) {
  unlinkSync(DB_PATH);
  console.log(`Bestaande database verwijderd: ${DB_PATH}`);
}

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(SCHEMA_SQL);

console.log(`Database geïnitialiseerd: ${DB_PATH}`);

// Brondocumenten (Sourcebooks)

interface SourcebookRow {
  id: string;
  name: string;
  description: string;
}

const sourcebooks: SourcebookRow[] = [
  {
    id: "AFM-LEIDRAAD",
    name: "AFM Leidraden",
    description:
      "Leidraden van de Autoriteit Financiële Markten met praktische uitleg over de toepassing van wet- en regelgeving, waaronder de Wwft-leidraad en leidraad informatieverstrekking.",
  },
  {
    id: "AFM-BELEIDSREGEL",
    name: "AFM Beleidsregels",
    description:
      "Beleidsregels van de AFM die bindend zijn voor de AFM zelf en richting geven aan de uitleg van regelgeving, waaronder de Beleidsregel Geschiktheid en Betrouwbaarheid.",
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

const insertSourcebook = db.prepare(
  "INSERT OR IGNORE INTO sourcebooks (id, name, description) VALUES (?, ?, ?)",
);

for (const sb of sourcebooks) {
  insertSourcebook.run(sb.id, sb.name, sb.description);
}

console.log(`${sourcebooks.length} brondocumenten ingevoerd`);

// Voorbeeldbepalingen

interface ProvisionRow {
  sourcebook_id: string;
  reference: string;
  title: string;
  text: string;
  type: string;
  status: string;
  effective_date: string;
  chapter: string;
  section: string;
}

const provisions: ProvisionRow[] = [
  // AFM Leidraad Wwft (Anti-witwassen en terrorismefinanciering)
  {
    sourcebook_id: "AFM-LEIDRAAD",
    reference: "Wwft-leidraad 1.1",
    title: "Reikwijdte en doel van de Wwft-leidraad",
    text: "Deze leidraad is bedoeld voor beleggingsondernemingen, beleggingsinstellingen en hun beheerders die onder toezicht staan van de AFM en verplicht zijn de Wet ter voorkoming van witwassen en financieren van terrorisme (Wwft) na te leven. De leidraad geeft een praktische toelichting op de verplichtingen uit de Wwft en de wijze waarop de AFM hierop toezicht houdt.",
    type: "leidraad",
    status: "van_kracht",
    effective_date: "2021-06-01",
    chapter: "1",
    section: "1.1",
  },
  {
    sourcebook_id: "AFM-LEIDRAAD",
    reference: "Wwft-leidraad 2.1",
    title: "Cliëntenonderzoek — algemene verplichting",
    text: "Op grond van artikel 3 Wwft zijn instellingen verplicht cliëntenonderzoek te verrichten. Het cliëntenonderzoek omvat: (a) het identificeren van de cliënt en het verifiëren van diens identiteit; (b) het identificeren van de uiteindelijk belanghebbende (UBO) en het nemen van redelijke maatregelen om diens identiteit te verifiëren; (c) het vaststellen van het doel en de beoogde aard van de zakelijke relatie; (d) het verrichten van een doorlopende controle op de zakelijke relatie en de tijdens de relatie verrichte transacties.",
    type: "leidraad",
    status: "van_kracht",
    effective_date: "2021-06-01",
    chapter: "2",
    section: "2.1",
  },
  {
    sourcebook_id: "AFM-LEIDRAAD",
    reference: "Wwft-leidraad 2.2",
    title: "Verscherpt cliëntenonderzoek — politiek prominente personen",
    text: "Bij politiek prominente personen (PEP's) zijn instellingen verplicht verscherpt cliëntenonderzoek te verrichten. Dit houdt in: (a) toestemming van het senior management voor het aangaan of voortzetten van de zakelijke relatie; (b) het nemen van adequate maatregelen om de bron van het vermogen en de bron van de middelen te achterhalen; (c) het verrichten van verscherpte en doorlopende controle op de zakelijke relatie.",
    type: "leidraad",
    status: "van_kracht",
    effective_date: "2021-06-01",
    chapter: "2",
    section: "2.2",
  },
  {
    sourcebook_id: "AFM-LEIDRAAD",
    reference: "Wwft-leidraad 3.1",
    title: "Meldingsplicht ongebruikelijke transacties",
    text: "Op grond van artikel 16 Wwft zijn instellingen verplicht ongebruikelijke transacties onverwijld te melden bij de Financiële inlichtingen eenheid (FIU-Nederland). Een transactie wordt aangemerkt als ongebruikelijk indien er aanleiding is om te veronderstellen dat deze verband kan houden met witwassen of financieren van terrorisme. Instellingen dienen hiervoor gebruik te maken van de door FIU-Nederland vastgestelde indicatoren.",
    type: "leidraad",
    status: "van_kracht",
    effective_date: "2021-06-01",
    chapter: "3",
    section: "3.1",
  },

  // AFM Leidraad Informatieverstrekking
  {
    sourcebook_id: "AFM-LEIDRAAD",
    reference: "Informatieverstrekking 1.1",
    title: "Doel en reikwijdte van de leidraad informatieverstrekking",
    text: "Deze leidraad beschrijft de normen die de AFM hanteert bij het beoordelen of financiële ondernemingen juiste, duidelijke en niet-misleidende informatie verstrekken aan (potentiële) cliënten. De normen zijn gebaseerd op artikel 4:19 Wft en de uitwerking in het Besluit Gedragstoezicht financiële ondernemingen (BGfo).",
    type: "leidraad",
    status: "van_kracht",
    effective_date: "2019-01-01",
    chapter: "1",
    section: "1.1",
  },
  {
    sourcebook_id: "AFM-LEIDRAAD",
    reference: "Informatieverstrekking 2.1",
    title: "Juist, duidelijk en niet-misleidend",
    text: "Informatie dient juist, duidelijk en niet-misleidend te zijn. Juistheid vereist dat de informatie feitelijk correct en volledig is. Duidelijkheid vereist dat de informatie begrijpelijk is voor de doelgroep. Niet-misleidend houdt in dat de informatie geen onjuiste indruk wekt, ook niet door weglating, onduidelijke presentatie of selectieve nadruk op positieve aspecten terwijl risico's worden verzwegen of onderbelicht.",
    type: "leidraad",
    status: "van_kracht",
    effective_date: "2019-01-01",
    chapter: "2",
    section: "2.1",
  },
  {
    sourcebook_id: "AFM-LEIDRAAD",
    reference: "Informatieverstrekking 3.2",
    title: "Kosten en risico's transparant vermelden",
    text: "Financiële ondernemingen zijn verplicht alle kosten en lasten die verband houden met een financieel product of dienst transparant te vermelden. Dit omvat eenmalige kosten, doorlopende kosten, transactiekosten en eventuele verborgen kosten. Risico's dienen duidelijk en prominent vermeld te worden, waarbij negatieve scenario's niet mogen worden weggelaten of verhullend worden gepresenteerd.",
    type: "leidraad",
    status: "van_kracht",
    effective_date: "2019-01-01",
    chapter: "3",
    section: "3.2",
  },

  // AFM Beleidsregel Geschiktheid
  {
    sourcebook_id: "AFM-BELEIDSREGEL",
    reference: "Geschiktheid 1.1",
    title: "Doel en reikwijdte beleidsregel geschiktheid",
    text: "Deze beleidsregel geeft invulling aan de geschiktheidseisen die op grond van artikel 4:9 Wft worden gesteld aan beleidsbepalers van financiële ondernemingen die onder toezicht van de AFM staan. Geschiktheid omvat kennis en ervaring, vaardigheden en professioneel gedrag. De AFM toetst geschiktheid bij de (her)benoeming van beleidsbepalers.",
    type: "beleidsregel",
    status: "van_kracht",
    effective_date: "2016-12-22",
    chapter: "1",
    section: "1.1",
  },
  {
    sourcebook_id: "AFM-BELEIDSREGEL",
    reference: "Geschiktheid 2.1",
    title: "Kennis en ervaring — vereisten",
    text: "Een beleidsbepaler dient aantoonbare kennis te hebben van: (a) de aard en risico's van de financiële producten en diensten die de onderneming aanbiedt; (b) de relevante wet- en regelgeving; (c) bedrijfskundige en financiële aangelegenheden; (d) integriteitsvraagstukken. Ervaring wordt beoordeeld op basis van eerdere functies en de relevantie daarvan voor de nieuwe functie.",
    type: "beleidsregel",
    status: "van_kracht",
    effective_date: "2016-12-22",
    chapter: "2",
    section: "2.1",
  },
  {
    sourcebook_id: "AFM-BELEIDSREGEL",
    reference: "Geschiktheid 3.1",
    title: "Collectieve geschiktheid van het bestuur",
    text: "De AFM beoordeelt niet alleen de individuele geschiktheid van bestuurders maar ook de collectieve geschiktheid van het bestuur als geheel. Het bestuur dient collectief te beschikken over voldoende en gevarieerde kennis en ervaring op alle voor de onderneming relevante gebieden. De AFM verwacht dat ondernemingen bij de samenstelling van het bestuur rekening houden met diversiteit van kennis, ervaring en achtergrond.",
    type: "beleidsregel",
    status: "van_kracht",
    effective_date: "2016-12-22",
    chapter: "3",
    section: "3.1",
  },

  // DNB Toezichtregelingen
  {
    sourcebook_id: "DNB-TOEZICHT",
    reference: "DNB-TR 1.1",
    title: "Toezichtregeling minimum eigenvermogensvereisten",
    text: "Op grond van artikel 3:57 Wft en de Capital Requirements Regulation (CRR) dienen banken en beleggingsondernemingen te allen tijde te voldoen aan de minimum eigenvermogensvereisten. Het minimale vereiste kapitaal bedraagt 8% van de risicogewogen activa (totaal kapitaalratio). Banken dienen daarnaast te voldoen aan het aanvullende kapitaalbuffersvereisten op grond van de CRD IV-richtlijn.",
    type: "toezichtregeling",
    status: "van_kracht",
    effective_date: "2014-01-01",
    chapter: "1",
    section: "1.1",
  },
  {
    sourcebook_id: "DNB-TOEZICHT",
    reference: "DNB-TR 2.1",
    title: "Liquiditeitstoezicht — Liquidity Coverage Ratio",
    text: "Banken zijn verplicht te allen tijde te voldoen aan de Liquidity Coverage Ratio (LCR) van minimaal 100%. De LCR vereist dat banken voldoende liquide activa van hoge kwaliteit (HQLA) aanhouden om een periode van 30 dagen van ernstige liquiditeitsstress te doorstaan. DNB houdt toezicht op de naleving van de LCR-vereisten en kan bij ontoereikende liquiditeit aanvullende maatregelen opleggen.",
    type: "toezichtregeling",
    status: "van_kracht",
    effective_date: "2015-10-01",
    chapter: "2",
    section: "2.1",
  },
  {
    sourcebook_id: "DNB-TOEZICHT",
    reference: "DNB-TR 3.1",
    title: "Integriteitstoezicht — beheerste en integere bedrijfsvoering",
    text: "Op grond van artikel 3:10 Wft zijn financiële ondernemingen verplicht hun bedrijfsvoering zodanig in te richten dat een beheerste en integere bedrijfsvoering is gewaarborgd. Dit omvat maatregelen gericht op het tegengaan van verstrengeling van privébelangen met bedrijfsbelangen, het voorkomen van strafbare feiten en het tegengaan van witwassen en financieren van terrorisme.",
    type: "toezichtregeling",
    status: "van_kracht",
    effective_date: "2007-01-01",
    chapter: "3",
    section: "3.1",
  },
  {
    sourcebook_id: "DNB-TOEZICHT",
    reference: "DNB-TR 4.1",
    title: "Uitbestedingsregels — behoud van toezichtbaarheid",
    text: "Financiële ondernemingen die activiteiten uitbesteden aan derden blijven verantwoordelijk voor de naleving van de toepasselijke wet- en regelgeving. Op grond van artikel 3:18 Wft dienen uitbestedingsovereenkomsten DNB in staat te stellen toezicht te houden op de uitbestede activiteiten. Uitbesteding aan entiteiten buiten de EER vereist bijzondere maatregelen om de toezichtbaarheid te waarborgen.",
    type: "toezichtregeling",
    status: "van_kracht",
    effective_date: "2007-01-01",
    chapter: "4",
    section: "4.1",
  },

  // DNB Good Practices Informatiebeveiliging
  {
    sourcebook_id: "DNB-GOODPRACTICE",
    reference: "Informatiebeveiliging 1.1",
    title: "DNB Good Practice Informatiebeveiliging — inleiding",
    text: "DNB verwacht van financiële instellingen dat zij robuuste maatregelen treffen om informatiebeveiliging te borgen. Deze Good Practice beschrijft de verwachtingen van DNB op het gebied van informatiebeveiliging, waaronder governance, risicobeheer, technische beveiliging en incidentrespons. De Good Practice is niet bindend maar geeft richting aan de toezichtpraktijk van DNB.",
    type: "good_practice",
    status: "van_kracht",
    effective_date: "2020-03-01",
    chapter: "1",
    section: "1.1",
  },
  {
    sourcebook_id: "DNB-GOODPRACTICE",
    reference: "Informatiebeveiliging 2.1",
    title: "Informatiebeveiligingsbeleid en governance",
    text: "DNB verwacht dat financiële instellingen een gedocumenteerd informatiebeveiligingsbeleid hebben dat door het bestuur is vastgesteld en periodiek wordt herzien. Het beleid dient aan te sluiten op een erkende beveiligingsstandaard zoals ISO 27001 of NIST. De verantwoordelijkheid voor informatiebeveiliging dient expliciet te zijn belegd op bestuursniveau (CISO of gelijkwaardig).",
    type: "good_practice",
    status: "van_kracht",
    effective_date: "2020-03-01",
    chapter: "2",
    section: "2.1",
  },
  {
    sourcebook_id: "DNB-GOODPRACTICE",
    reference: "Informatiebeveiliging 3.1",
    title: "Cyberweerbaarheid en incidentrespons",
    text: "Instellingen dienen over een gedocumenteerd en getest incidentresponsplan te beschikken. DNB verwacht dat instellingen cyberincidenten tijdig melden bij DNB conform de meldplicht ernstige incidenten (artikel 3:17b Wft). Het incidentresponsplan dient scenario's te bevatten voor ransomware-aanvallen, datalekken en verstoring van kritieke systemen.",
    type: "good_practice",
    status: "van_kracht",
    effective_date: "2020-03-01",
    chapter: "3",
    section: "3.1",
  },

  // DNB Guidance on Outsourcing
  {
    sourcebook_id: "DNB-GOODPRACTICE",
    reference: "Outsourcing 1.1",
    title: "DNB Guidance Uitbesteding — reikwijdte en verwachtingen",
    text: "Deze guidance beschrijft de verwachtingen van DNB bij uitbesteding van kritieke of belangrijke functies door financiële instellingen. DNB sluit aan bij de EBA Guidelines on Outsourcing Arrangements (EBA/GL/2019/02). Van instellingen wordt verwacht dat zij een gedegen due diligence uitvoeren bij de selectie van dienstverleners en de uitbestedingsrelatie gedurende de looptijd actief beheren.",
    type: "good_practice",
    status: "van_kracht",
    effective_date: "2019-09-25",
    chapter: "1",
    section: "1.1",
  },
  {
    sourcebook_id: "DNB-GOODPRACTICE",
    reference: "Outsourcing 2.1",
    title: "Uitbestedingsregister en exitstrategieën",
    text: "Financiële instellingen dienen een actueel register bij te houden van alle uitbestedingsovereenkomsten, met onderscheid tussen kritieke en niet-kritieke uitbesteding. Voor alle kritieke uitbesteding dient een gedocumenteerde exitstrategie beschikbaar te zijn die de continuïteit van dienstverlening waarborgt bij beëindiging van de uitbestedingsrelatie. DNB beoordeelt de kwaliteit van het uitbestedingsregister en de exitstrategieën in het reguliere toezicht.",
    type: "good_practice",
    status: "van_kracht",
    effective_date: "2019-09-25",
    chapter: "2",
    section: "2.1",
  },
];

const insertProvision = db.prepare(`
  INSERT INTO provisions (sourcebook_id, reference, title, text, type, status, effective_date, chapter, section)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertAll = db.transaction(() => {
  for (const p of provisions) {
    insertProvision.run(
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
  }
});

insertAll();

console.log(`${provisions.length} voorbeeldbepalingen ingevoerd`);

// Voorbeeldhandhavingsacties

interface EnforcementRow {
  firm_name: string;
  reference_number: string;
  action_type: string;
  amount: number;
  date: string;
  summary: string;
  sourcebook_references: string;
}

const enforcements: EnforcementRow[] = [
  {
    firm_name: "ING Bank N.V.",
    reference_number: "AFM-2018-0001",
    action_type: "boete",
    amount: 775_000,
    date: "2018-09-04",
    summary:
      "De AFM heeft ING Bank N.V. een bestuurlijke boete opgelegd van EUR 775.000 wegens overtreding van de Wwft. ING heeft nagelaten adequaat cliëntenonderzoek te verrichten en ongebruikelijke transacties tijdig te melden bij FIU-Nederland. De tekortkomingen betroffen een periode van meerdere jaren en omvatten zowel particuliere als zakelijke klanten.",
    sourcebook_references: "Wwft-leidraad 2.1, Wwft-leidraad 3.1",
  },
  {
    firm_name: "ABN AMRO Bank N.V.",
    reference_number: "AFM-2021-0003",
    action_type: "boete",
    amount: 480_000,
    date: "2021-04-19",
    summary:
      "ABN AMRO Bank N.V. heeft een schikking getroffen met het Openbaar Ministerie van EUR 480 miljoen in verband met ernstige tekortkomingen in de naleving van de Wwft. De bank heeft gedurende een langere periode nagelaten om klanten adequaat te screenen en ongebruikelijke transacties te melden. ABN AMRO heeft daarnaast omvangrijke herstelmaatregelen getroffen waaronder de versterking van de compliance-organisatie.",
    sourcebook_references: "Wwft-leidraad 2.1, Wwft-leidraad 2.2, Wwft-leidraad 3.1",
  },
  {
    firm_name: "Triodos Bank N.V.",
    reference_number: "DNB-2022-0007",
    action_type: "aanwijzing",
    amount: 0,
    date: "2022-11-15",
    summary:
      "DNB heeft Triodos Bank N.V. een aanwijzing gegeven wegens tekortkomingen in het liquiditeitsrisicobeheer. De bank voldeed tijdelijk niet aan de vereisten voor de Liquidity Coverage Ratio (LCR). DNB heeft Triodos opgedragen de liquiditeitsbeheerprocedures te versterken en aanvullende HQLA-buffers aan te houden. De situatie is inmiddels hersteld.",
    sourcebook_references: "DNB-TR 2.1",
  },
];

const insertEnforcement = db.prepare(`
  INSERT INTO enforcement_actions (firm_name, reference_number, action_type, amount, date, summary, sourcebook_references)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const insertEnforcementsAll = db.transaction(() => {
  for (const e of enforcements) {
    insertEnforcement.run(
      e.firm_name,
      e.reference_number,
      e.action_type,
      e.amount,
      e.date,
      e.summary,
      e.sourcebook_references,
    );
  }
});

insertEnforcementsAll();

console.log(`${enforcements.length} voorbeeldhandhavingsacties ingevoerd`);

// Samenvatting

const provisionCount = (
  db.prepare("SELECT count(*) as cnt FROM provisions").get() as {
    cnt: number;
  }
).cnt;
const sourcebookCount = (
  db.prepare("SELECT count(*) as cnt FROM sourcebooks").get() as {
    cnt: number;
  }
).cnt;
const enforcementCount = (
  db.prepare("SELECT count(*) as cnt FROM enforcement_actions").get() as {
    cnt: number;
  }
).cnt;
const ftsCount = (
  db.prepare("SELECT count(*) as cnt FROM provisions_fts").get() as {
    cnt: number;
  }
).cnt;

console.log(`\nDatabaseoverzicht:`);
console.log(`  Brondocumenten:       ${sourcebookCount}`);
console.log(`  Bepalingen:           ${provisionCount}`);
console.log(`  Handhavingsacties:    ${enforcementCount}`);
console.log(`  FTS-vermeldingen:     ${ftsCount}`);
console.log(`\nKlaar. Database beschikbaar op ${DB_PATH}`);

db.close();
