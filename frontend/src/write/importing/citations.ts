/**
 * Citations made by reference managers in Word, as BibTeX.
 *
 * Zotero and Mendeley keep every cited item's data (CSL JSON) inside the
 * citation field, and Word's own citations point at sources stored in the
 * document. Either way the paper keeps real citations: each becomes a
 * \cite of a BibTeX entry written from that data.
 */

import { child, elements, textOf } from "./xml.ts";
import type { XmlElement } from "./xml.ts";

interface CslName {
  family?: string;
  given?: string;
  literal?: string;
}

export interface CslItem {
  id?: string | number;
  type?: string;
  title?: string;
  "container-title"?: string;
  author?: CslName[];
  editor?: CslName[];
  issued?: { "date-parts"?: (string | number)[][]; raw?: string; literal?: string };
  volume?: string | number;
  issue?: string | number;
  page?: string;
  publisher?: string;
  "publisher-place"?: string;
  DOI?: string;
  URL?: string;
  ISBN?: string;
  ISSN?: string;
  edition?: string | number;
  number?: string | number;
  genre?: string;
  [key: string]: unknown;
}

export interface CitedItem {
  key: string;
  prefix: string;
  locator: string;
}

/** Collects BibTeX entries and gives each distinct item one key. */
export class Bibliography {
  private readonly entries = new Map<string, string>();
  private readonly keysByItem = new Map<string, string>();

  get size(): number {
    return this.entries.size;
  }

  toBibtex(): string {
    return [...this.entries.values()].join("\n\n");
  }

  private uniqueKey(base: string): string {
    const clean = base.replace(/[^A-Za-z0-9]/g, "") || "ref";
    let key = clean;
    let suffix = 0;
    while (this.entries.has(key)) key = `${clean}${String.fromCharCode(97 + suffix++)}`;
    return key;
  }

  /** The key for a CSL item, adding its entry the first time. */
  addCsl(item: CslItem, identity: string): string {
    const known = this.keysByItem.get(identity);
    if (known) return known;
    const names = item.author?.length ? item.author : item.editor ?? [];
    const year = cslYear(item);
    const first = names[0]?.family ?? names[0]?.literal ?? item.title?.split(/\s+/)[0] ?? "ref";
    const key = this.uniqueKey(`${asciiFold(first).toLowerCase()}${year}`);
    this.entries.set(key, cslToBibtex(item, key));
    this.keysByItem.set(identity, key);
    return key;
  }

  /** The key for a Word source (by its tag), adding its entry the first time. */
  addWordSource(source: XmlElement): string {
    const tag = textOf(child(source, "Tag")).trim();
    const identity = `word:${tag}`;
    const known = this.keysByItem.get(identity);
    if (known) return known;
    const key = this.uniqueKey(tag || "ref");
    this.entries.set(key, wordSourceToBibtex(source, key));
    this.keysByItem.set(identity, key);
    return key;
  }
}

function asciiFold(value: string): string {
  return value.normalize("NFKD").replace(/[̀-ͯ]/g, "");
}

function cslYear(item: CslItem): string {
  const part = item.issued?.["date-parts"]?.[0]?.[0];
  if (part !== undefined && String(part).trim()) return String(part).trim();
  const raw = item.issued?.raw ?? item.issued?.literal ?? "";
  return /\d{4}/.exec(raw)?.[0] ?? "";
}

/** BibTeX field values: braces balanced, specials escaped, case kept with braces. */
function bibValue(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\\]/g, "\\textbackslash{}")
    .replace(/[{}]/g, "")
    .replace(/([&%$#_])/g, "\\$1");
}

function cslNames(names: CslName[] | undefined): string {
  return (names ?? [])
    .map((name) => (name.literal ? `{${bibValue(name.literal)}}` : [name.family, name.given].filter(Boolean).map(bibValue).join(", ")))
    .filter(Boolean)
    .join(" and ");
}

const CSL_TYPES: Record<string, string> = {
  "article-journal": "article",
  article: "article",
  "article-magazine": "article",
  "article-newspaper": "article",
  book: "book",
  chapter: "incollection",
  "paper-conference": "inproceedings",
  report: "techreport",
  thesis: "phdthesis",
  manuscript: "unpublished",
  webpage: "misc",
  "post-weblog": "misc",
  dataset: "misc",
  software: "misc",
};

function field(name: string, value: unknown): string | null {
  const text = bibValue(value);
  return text ? `  ${name} = {${name === "title" ? `{${text}}` : text}}` : null;
}

export function cslToBibtex(item: CslItem, key: string): string {
  const type = CSL_TYPES[item.type ?? ""] ?? "misc";
  const container = type === "inproceedings" || type === "incollection" ? "booktitle" : type === "article" ? "journal" : "howpublished";
  const fields = [
    field("author", cslNames(item.author)),
    type === "book" || type === "incollection" || type === "inproceedings" ? field("editor", cslNames(item.editor)) : null,
    field("title", item.title),
    item["container-title"] ? field(container, item["container-title"]) : null,
    field("year", cslYear(item)),
    field("volume", item.volume),
    field("number", item.issue ?? item.number),
    field("pages", typeof item.page === "string" ? item.page.replace(/\s*[-–]\s*/, "--") : item.page),
    field(type === "techreport" ? "institution" : type === "phdthesis" ? "school" : "publisher", item.publisher),
    field("address", item["publisher-place"]),
    field("edition", item.edition),
    field("doi", item.DOI),
    field("url", item.URL),
    field("isbn", item.ISBN),
  ].filter((line): line is string => line !== null);
  return `@${type}{${key},\n${fields.join(",\n")}\n}`;
}

const WORD_TYPES: Record<string, string> = {
  JournalArticle: "article",
  ArticleInAPeriodical: "article",
  Book: "book",
  BookSection: "incollection",
  ConferenceProceedings: "inproceedings",
  Report: "techreport",
  InternetSite: "misc",
  DocumentFromInternetSite: "misc",
  Misc: "misc",
};

function wordPeople(source: XmlElement, role: string): string {
  const holder = child(child(source, "Author"), role);
  const people = elements(child(holder, "NameList"), "Person").map((person) => {
    const last = textOf(child(person, "Last")).trim();
    const first = [textOf(child(person, "First")).trim(), textOf(child(person, "Middle")).trim()].filter(Boolean).join(" ");
    return [last, first].filter(Boolean).map(bibValue).join(", ");
  });
  const corporate = textOf(child(holder, "Corporate")).trim();
  if (corporate) people.push(`{${bibValue(corporate)}}`);
  return people.filter(Boolean).join(" and ");
}

export function wordSourceToBibtex(source: XmlElement, key: string): string {
  const text = (name: string) => textOf(child(source, name)).trim();
  const type = WORD_TYPES[text("SourceType")] ?? "misc";
  const container = type === "inproceedings" || type === "incollection" ? "booktitle" : type === "article" ? "journal" : "howpublished";
  const fields = [
    field("author", wordPeople(source, "Author")),
    field("editor", wordPeople(source, "Editor")),
    field("title", text("Title")),
    field(container, text("JournalName") || text("PeriodicalTitle") || text("BookTitle") || text("ConferenceName")),
    field("year", text("Year")),
    field("volume", text("Volume")),
    field("number", text("Issue")),
    field("pages", text("Pages").replace(/\s*[-–]\s*/, "--")),
    field("publisher", text("Publisher")),
    field("address", text("City")),
    field("doi", text("DOI")),
    field("url", text("URL")),
  ].filter((line): line is string => line !== null);
  return `@${type}{${key},\n${fields.join(",\n")}\n}`;
}

interface CslCitation {
  citationItems?: { id?: string | number; uris?: string[]; uri?: string[]; itemData?: CslItem; locator?: string; label?: string; prefix?: string; suffix?: string }[];
  properties?: { formattedCitation?: string; plainCitation?: string };
}

const LOCATOR_LABELS: Record<string, string> = { page: "p.", chapter: "ch.", section: "sec.", figure: "fig.", table: "tab.", line: "l.", note: "n.", volume: "vol." };

/**
 * A Zotero (`ADDIN ZOTERO_ITEM CSL_CITATION {…}`) or Mendeley
 * (`ADDIN CSL_CITATION {…}`) field instruction as cited items, or null.
 */
export function cslCitation(instruction: string, bibliography: Bibliography): { items: CitedItem[]; formatted: string } | null {
  const start = instruction.indexOf("{");
  if (!/\bCSL_CITATION\b/.test(instruction) || start === -1) return null;
  let data: CslCitation;
  try {
    data = JSON.parse(instruction.slice(start, instruction.lastIndexOf("}") + 1)) as CslCitation;
  } catch {
    return null;
  }
  const items: CitedItem[] = [];
  for (const entry of data.citationItems ?? []) {
    if (!entry.itemData) continue;
    const identity = entry.uris?.[0] ?? entry.uri?.[0] ?? String(entry.id ?? entry.itemData.id ?? JSON.stringify(entry.itemData).slice(0, 200));
    const key = bibliography.addCsl(entry.itemData, identity);
    const label = entry.label && entry.label !== "page" ? `${LOCATOR_LABELS[entry.label] ?? entry.label} ` : entry.locator ? "p.~" : "";
    items.push({ key, prefix: (entry.prefix ?? "").trim(), locator: entry.locator ? `${label}${entry.locator}`.replace(/\.\s+/, ".~") : (entry.suffix ?? "").replace(/^,\s*/, "").trim() });
  }
  if (!items.length) return null;
  return { items, formatted: data.properties?.formattedCitation ?? data.properties?.plainCitation ?? "" };
}

/** The tags a Word `CITATION Tag \l 1033 \m Other` field cites. */
export function wordCitationTags(instruction: string): string[] {
  const match = /^\s*CITATION\s+(\S+)/i.exec(instruction);
  if (!match) return [];
  const tags = [match[1]];
  for (const extra of instruction.matchAll(/\\m\s+(\S+)/g)) tags.push(extra[1]);
  return tags;
}
