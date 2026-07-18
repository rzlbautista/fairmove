import { z } from "zod";

/**
 * The JobSpec is the single structured specification of the job.
 *
 * Both intake paths (ElevenLabs voice interview and document upload) must
 * produce this exact shape, the user confirms it once, and it is then reused
 * verbatim in every outbound call. Nothing downstream is allowed to invent a
 * field that is not in here — that is the honesty boundary.
 */

export const AccessSchema = z.object({
  floor: z.number().int().min(0).max(60),
  elevator: z.boolean(),
  /** Flights of stairs the crew must carry up/down. 0 when there is an elevator or ground floor. */
  stairFlights: z.number().int().min(0).max(20),
  /** Distance from the closest legal truck parking to the door, in feet. */
  longCarryFeet: z.number().int().min(0).max(1000),
  parkingNotes: z.string().max(400).default(""),
});
export type Access = z.infer<typeof AccessSchema>;

export const InventoryItemSchema = z.object({
  name: z.string().min(1).max(80),
  quantity: z.number().int().min(1).max(200),
  /** Free-text room label, e.g. "primary bedroom". */
  room: z.string().max(60).default(""),
  /** Anything the crew must handle specially — disassembly, crating, two-person lift. */
  handling: z.string().max(120).default(""),
});
export type InventoryItem = z.infer<typeof InventoryItemSchema>;

export const SpecialItemSchema = z.object({
  /** Must match a key in the vertical config's priceModel.specialItemFees to be priced. */
  kind: z.enum(["piano", "gunSafe", "treadmill", "poolTable", "fishTank", "other"]),
  description: z.string().max(160).default(""),
});
export type SpecialItem = z.infer<typeof SpecialItemSchema>;

export const PackingLevel = z.enum(["none", "partial", "full"]);
export const ValuationCoverage = z.enum(["released", "fullValue"]);

export const AddressSchema = z.object({
  label: z.string().min(1).max(120),
  city: z.string().min(1).max(80),
  state: z.string().min(2).max(2),
  zip: z.string().regex(/^\d{5}$/, "5-digit ZIP required"),
});
export type Address = z.infer<typeof AddressSchema>;

export const JobSpecSchema = z.object({
  id: z.string().min(1),
  vertical: z.literal("moving"),
  /** Bumped every time the user edits after intake; calls record which version they used. */
  specVersion: z.number().int().min(1).default(1),

  customerName: z.string().min(1).max(80),
  customerPhone: z.string().max(32).default(""),

  origin: AddressSchema,
  destination: AddressSchema,
  miles: z.number().min(0).max(3000),

  /** ISO date (YYYY-MM-DD). */
  moveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "moveDate must be YYYY-MM-DD"),
  dateFlexible: z.boolean().default(false),

  bedrooms: z.number().int().min(0).max(4),
  inventory: z.array(InventoryItemSchema).default([]),
  specialItems: z.array(SpecialItemSchema).default([]),

  originAccess: AccessSchema,
  destinationAccess: AccessSchema,

  packing: PackingLevel,
  valuationCoverage: ValuationCoverage,

  accessNotes: z.string().max(1000).default(""),

  /** Provenance so the report can show how the spec was built. */
  source: z.object({
    paths: z.array(z.enum(["voice", "document", "manual"])).min(1),
    /** ElevenLabs conversation id for the voice interview, when there was one. */
    interviewConversationId: z.string().nullable().default(null),
    documentNames: z.array(z.string()).default([]),
    notes: z.string().max(600).default(""),
  }),

  confirmedAt: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type JobSpec = z.infer<typeof JobSpecSchema>;

/** Partial spec emitted by an intake path before the user confirms. */
export const JobSpecDraftSchema = JobSpecSchema.partial().extend({
  vertical: z.literal("moving").default("moving"),
});
export type JobSpecDraft = z.infer<typeof JobSpecDraftSchema>;

/**
 * Fields a call is allowed to talk about. Used to assert that the caller agent
 * describes the same job every time — see tests/jobspec-identity.test.ts.
 */
export function specFingerprint(spec: JobSpec): string {
  const material = {
    origin: spec.origin,
    destination: spec.destination,
    miles: spec.miles,
    moveDate: spec.moveDate,
    bedrooms: spec.bedrooms,
    inventory: [...spec.inventory].sort((a, b) => a.name.localeCompare(b.name)),
    specialItems: [...spec.specialItems].sort((a, b) => a.kind.localeCompare(b.kind)),
    originAccess: spec.originAccess,
    destinationAccess: spec.destinationAccess,
    packing: spec.packing,
    valuationCoverage: spec.valuationCoverage,
  };
  return hashString(JSON.stringify(material));
}

function hashString(input: string): string {
  // FNV-1a — enough to prove two calls used byte-identical job material.
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function missingRequiredFields(draft: JobSpecDraft, required: string[]): string[] {
  return required.filter((path) => {
    const value = path.split(".").reduce<unknown>((acc, key) => {
      if (acc && typeof acc === "object" && key in (acc as Record<string, unknown>)) {
        return (acc as Record<string, unknown>)[key];
      }
      return undefined;
    }, draft as unknown);
    return value === undefined || value === null || value === "";
  });
}
