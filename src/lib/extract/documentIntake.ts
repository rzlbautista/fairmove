import { JobSpecDraftSchema, type JobSpecDraft } from "../domain/jobspec";

/**
 * Document intake path.
 *
 * A moving inventory list, a written estimate from another company, or a
 * handwritten room list typed up — all parsed into the SAME JobSpec shape the
 * voice interview produces. The two paths converge on one structure; the user
 * confirms it once.
 *
 * This parser is deterministic on purpose: it never invents a field. Anything
 * it cannot read is left undefined so the confirmation UI shows it as missing
 * and the user fills it in, rather than a plausible-looking guess reaching a
 * phone call.
 */

export interface DocumentIntakeResult {
  draft: JobSpecDraft;
  /** Field path -> the exact source line it came from, for the UI to show provenance. */
  provenance: Record<string, string>;
  /** Fields the document simply did not contain. */
  missing: string[];
  warnings: string[];
}

const ROOM_WORDS = /\b(bedroom|bed room|br)\b/i;

const ITEM_LINE = /^\s*(?:[-*•]\s*)?(?:(\d+)\s*(?:x|×)?\s+)?([A-Za-z][A-Za-z\s'/-]{2,60}?)\s*(?:\((.+?)\))?\s*$/;

const NON_ITEM = /^(inventory|items?|contents|list|summary|total|subtotal|estimate|quote|notes?|from|to|date|address|packing|stairs|floor|access)\b/i;

export function parseDocument(text: string, filename = "document"): DocumentIntakeResult {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const draft: JobSpecDraft = { vertical: "moving" };
  const provenance: Record<string, string> = {};
  const warnings: string[] = [];

  const record = <K extends keyof JobSpecDraft>(field: K, value: JobSpecDraft[K], line: string) => {
    draft[field] = value;
    provenance[field as string] = line;
  };

  for (const line of lines) {
    // --- customer -------------------------------------------------------
    const name = line.match(/^(?:customer|client|name)\s*[:\-]\s*(.+)$/i);
    if (name) record("customerName", name[1].trim(), line);

    const phone = line.match(/^(?:phone|mobile|tel|contact)\s*[:\-]\s*(.+)$/i);
    if (phone) record("customerPhone", phone[1].trim(), line);

    // --- route ----------------------------------------------------------
    const from = line.match(/^(?:from|origin|pick.?up|moving from)\s*[:\-]\s*(.+)$/i);
    if (from) {
      const parsed = parseAddress(from[1]);
      if (parsed) record("origin", parsed, line);
      else warnings.push(`Could not parse origin address from: "${line}"`);
    }

    const to = line.match(/^(?:to|destination|drop.?off|delivery|moving to)\s*[:\-]\s*(.+)$/i);
    if (to) {
      const parsed = parseAddress(to[1]);
      if (parsed) record("destination", parsed, line);
      else warnings.push(`Could not parse destination address from: "${line}"`);
    }

    const miles = line.match(/(\d{1,4}(?:\.\d)?)\s*(?:mi|miles)\b/i);
    if (miles && draft.miles === undefined) record("miles", Number(miles[1]), line);

    // --- date -----------------------------------------------------------
    const iso = line.match(/^(?:move ?date|date|moving on|scheduled)\s*[:\-]\s*(.+)$/i);
    if (iso) {
      const date = parseDate(iso[1]);
      if (date) record("moveDate", date, line);
      else warnings.push(`Could not parse a date from: "${line}"`);
    }
    if (/\bflexible\b/i.test(line) && /date/i.test(line)) record("dateFlexible", true, line);

    // --- size -----------------------------------------------------------
    const bedrooms = line.match(/(\d)\s*[-\s]?(?:bed\s?room|bedroom|br)\b/i);
    if (bedrooms && draft.bedrooms === undefined && ROOM_WORDS.test(line)) {
      record("bedrooms", Number(bedrooms[1]), line);
    }

    // --- access ---------------------------------------------------------
    const originAccess = line.match(/^(?:origin|pick.?up|from)\s*(?:access|floor)\s*[:\-]\s*(.+)$/i);
    if (originAccess) record("originAccess", parseAccess(originAccess[1]), line);

    const destAccess = line.match(/^(?:destination|delivery|drop.?off|to)\s*(?:access|floor)\s*[:\-]\s*(.+)$/i);
    if (destAccess) record("destinationAccess", parseAccess(destAccess[1]), line);

    // --- services -------------------------------------------------------
    const packing = line.match(/^packing\s*[:\-]\s*(.+)$/i);
    if (packing) {
      const value = packing[1].toLowerCase();
      const level = /full/.test(value) ? "full" : /partial|some/.test(value) ? "partial" : /none|self|myself|diy/.test(value) ? "none" : null;
      if (level) record("packing", level, line);
      else warnings.push(`Unrecognised packing level: "${packing[1]}"`);
    }

    const coverage = line.match(/^(?:coverage|valuation|insurance)\s*[:\-]\s*(.+)$/i);
    if (coverage) {
      record("valuationCoverage", /full/i.test(coverage[1]) ? "fullValue" : "released", line);
    }

    const notes = line.match(/^(?:notes?|access notes?|constraints?)\s*[:\-]\s*(.+)$/i);
    if (notes) record("accessNotes", notes[1].trim(), line);
  }

  // --- inventory ---------------------------------------------------------
  const { items, specialItems, sourceLines } = parseInventory(lines);
  if (items.length) {
    draft.inventory = items;
    provenance.inventory = `${items.length} item lines (e.g. "${sourceLines[0]}")`;
  }
  if (specialItems.length) {
    draft.specialItems = specialItems;
    provenance.specialItems = specialItems.map((s) => s.kind).join(", ");
  }

  // Bedrooms can be inferred from room labels, but only when the document did
  // not state it — and we say so, rather than presenting it as read.
  if (draft.bedrooms === undefined) {
    const rooms = new Set(
      lines
        .map((l) => l.match(/^\s*(?:room|location)\s*[:\-]\s*(.+bedroom.*)$/i)?.[1]?.toLowerCase())
        .filter(Boolean),
    );
    if (rooms.size > 0) {
      draft.bedrooms = Math.min(4, rooms.size);
      provenance.bedrooms = `inferred from ${rooms.size} distinct bedroom labels — please confirm`;
      warnings.push("Bedroom count was inferred from room labels, not stated in the document. Confirm it before calling.");
    }
  }

  draft.source = {
    paths: ["document"],
    interviewConversationId: null,
    documentNames: [filename],
    notes: `Parsed ${lines.length} lines from ${filename}.`,
  };

  const parsed = JobSpecDraftSchema.parse(draft);
  const missing = requiredMissing(parsed);

  return { draft: parsed, provenance, missing, warnings };
}

function parseAddress(input: string) {
  // "1420 Cherry Rd, Rock Hill, SC 29732"
  const match = input.match(/^(.*?),\s*([A-Za-z .'-]+),\s*([A-Z]{2})\s*(\d{5})/);
  if (!match) return undefined;
  return {
    label: match[1].trim(),
    city: match[2].trim(),
    state: match[3].toUpperCase(),
    zip: match[4],
  };
}

function parseAccess(input: string) {
  const floor = input.match(/(?:floor|fl\.?|level)\s*(\d+)|(\d+)(?:st|nd|rd|th)\s*floor/i);
  const flights = input.match(/(\d+)\s*flight/i);
  const carry = input.match(/(\d+)\s*(?:ft|feet|foot)/i);
  const elevator = /\belevator|\blift\b/i.test(input) && !/no elevator/i.test(input);

  const floorNumber = floor ? Number(floor[1] ?? floor[2]) : 0;
  return {
    floor: floorNumber,
    elevator,
    stairFlights: flights ? Number(flights[1]) : elevator ? 0 : Math.max(0, floorNumber - 1),
    longCarryFeet: carry ? Number(carry[1]) : 0,
    parkingNotes: /permit|dock|gate|narrow|no parking/i.test(input) ? input.trim() : "",
  };
}

function parseDate(input: string): string | undefined {
  const trimmed = input.trim();
  const isoMatch = trimmed.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return isoMatch[0];

  const us = trimmed.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (us) return `${us[3]}-${pad(us[1])}-${pad(us[2])}`;

  const named = trimmed.match(
    /(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})/i,
  );
  if (named) {
    const month = new Date(`${named[1]} 1, 2000`).getMonth() + 1;
    return `${named[3]}-${pad(month)}-${pad(named[2])}`;
  }
  return undefined;
}

function pad(n: string | number): string {
  return String(n).padStart(2, "0");
}

const SPECIAL_MAP: Array<{ pattern: RegExp; kind: "piano" | "gunSafe" | "treadmill" | "poolTable" | "fishTank" }> = [
  { pattern: /\bpiano\b/i, kind: "piano" },
  { pattern: /\b(gun ?safe|safe)\b/i, kind: "gunSafe" },
  { pattern: /\btreadmill\b/i, kind: "treadmill" },
  { pattern: /\bpool table\b/i, kind: "poolTable" },
  { pattern: /\b(fish tank|aquarium)\b/i, kind: "fishTank" },
];

function parseInventory(lines: string[]) {
  const items: Array<{ name: string; quantity: number; room: string; handling: string }> = [];
  const specialItems: Array<{ kind: "piano" | "gunSafe" | "treadmill" | "poolTable" | "fishTank" | "other"; description: string }> = [];
  const sourceLines: string[] = [];

  let inInventory = false;
  let currentRoom = "";

  for (const line of lines) {
    if (/^(inventory|large items?|item list|contents)\b/i.test(line)) {
      inInventory = true;
      continue;
    }
    if (/^(notes?|total|subtotal|estimate|signature|terms)\b/i.test(line)) {
      inInventory = false;
      continue;
    }

    const roomHeader = line.match(/^\s*(?:room\s*[:\-]\s*)?([A-Za-z ]+(?:bedroom|kitchen|living room|dining room|garage|office|basement|patio))\s*:?\s*$/i);
    if (roomHeader) {
      currentRoom = roomHeader[1].trim();
      inInventory = true;
      continue;
    }

    if (!inInventory) continue;
    if (NON_ITEM.test(line)) continue;
    if (/\$\s?\d/.test(line)) continue; // a priced line belongs to a quote, not an inventory

    const match = line.match(ITEM_LINE);
    if (!match) continue;

    const name = match[2].trim();
    if (name.length < 3) continue;

    const quantity = match[1] ? Number(match[1]) : 1;
    const handling = match[3]?.trim() ?? "";

    items.push({ name, quantity, room: currentRoom, handling });
    sourceLines.push(line);

    const special = SPECIAL_MAP.find((s) => s.pattern.test(name));
    if (special && !specialItems.some((s) => s.kind === special.kind)) {
      specialItems.push({ kind: special.kind, description: `${name}${handling ? ` (${handling})` : ""}` });
    }
  }

  return { items, specialItems, sourceLines };
}

const REQUIRED: Array<{ path: string; label: string }> = [
  { path: "customerName", label: "Customer name" },
  { path: "origin", label: "Origin address" },
  { path: "destination", label: "Destination address" },
  { path: "miles", label: "Distance in miles" },
  { path: "moveDate", label: "Move date" },
  { path: "bedrooms", label: "Bedroom count" },
  { path: "originAccess", label: "Pickup access (floor / stairs / carry)" },
  { path: "destinationAccess", label: "Delivery access (floor / stairs / carry)" },
  { path: "packing", label: "Packing level" },
  { path: "valuationCoverage", label: "Coverage preference" },
];

function requiredMissing(draft: JobSpecDraft): string[] {
  return REQUIRED.filter((r) => (draft as Record<string, unknown>)[r.path] === undefined).map((r) => r.label);
}

/**
 * Merges a document draft over a voice draft (or vice versa). Both intake paths
 * produce the same shape, so convergence is a merge, not a translation.
 */
export function mergeDrafts(primary: JobSpecDraft, secondary: JobSpecDraft): JobSpecDraft {
  const merged: Record<string, unknown> = { ...secondary };
  for (const [key, value] of Object.entries(primary)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    merged[key] = value;
  }
  merged.source = {
    paths: Array.from(
      new Set([...(secondary.source?.paths ?? []), ...(primary.source?.paths ?? [])]),
    ),
    interviewConversationId:
      primary.source?.interviewConversationId ?? secondary.source?.interviewConversationId ?? null,
    documentNames: Array.from(
      new Set([...(secondary.source?.documentNames ?? []), ...(primary.source?.documentNames ?? [])]),
    ),
    notes: [secondary.source?.notes, primary.source?.notes].filter(Boolean).join(" "),
  };
  return JobSpecDraftSchema.parse(merged);
}
