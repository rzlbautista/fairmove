import { JobSpecDraftSchema, type JobSpecDraft } from "../domain/jobspec";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

const EXTRACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    customerName: { type: ["string", "null"] },
    customerPhone: { type: ["string", "null"] },
    origin: {
      type: ["object", "null"],
      additionalProperties: false,
      properties: {
        label: { type: "string" },
        city: { type: "string" },
        state: { type: "string" },
        zip: { type: "string" },
      },
      required: ["label", "city", "state", "zip"],
    },
    destination: {
      type: ["object", "null"],
      additionalProperties: false,
      properties: {
        label: { type: "string" },
        city: { type: "string" },
        state: { type: "string" },
        zip: { type: "string" },
      },
      required: ["label", "city", "state", "zip"],
    },
    miles: { type: ["number", "null"] },
    moveDate: { type: ["string", "null"] },
    dateFlexible: { type: ["boolean", "null"] },
    bedrooms: { type: ["integer", "null"] },
    inventory: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          quantity: { type: "integer" },
          room: { type: "string" },
          handling: { type: "string" },
        },
        required: ["name", "quantity", "room", "handling"],
      },
    },
    specialItems: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: {
            type: "string",
            enum: ["piano", "gunSafe", "treadmill", "poolTable", "fishTank", "other"],
          },
          description: { type: "string" },
        },
        required: ["kind", "description"],
      },
    },
    originAccess: {
      type: ["object", "null"],
      additionalProperties: false,
      properties: {
        floor: { type: "integer" },
        elevator: { type: "boolean" },
        stairFlights: { type: "integer" },
        longCarryFeet: { type: "integer" },
        parkingNotes: { type: "string" },
      },
      required: ["floor", "elevator", "stairFlights", "longCarryFeet", "parkingNotes"],
    },
    destinationAccess: {
      type: ["object", "null"],
      additionalProperties: false,
      properties: {
        floor: { type: "integer" },
        elevator: { type: "boolean" },
        stairFlights: { type: "integer" },
        longCarryFeet: { type: "integer" },
        parkingNotes: { type: "string" },
      },
      required: ["floor", "elevator", "stairFlights", "longCarryFeet", "parkingNotes"],
    },
    packing: { type: ["string", "null"], enum: ["none", "partial", "full", null] },
    valuationCoverage: {
      type: ["string", "null"],
      enum: ["released", "fullValue", null],
    },
    accessNotes: { type: ["string", "null"] },
    provenance: {
      type: "object",
      additionalProperties: { type: "string" },
    },
    warnings: { type: "array", items: { type: "string" } },
  },
  required: [
    "customerName",
    "customerPhone",
    "origin",
    "destination",
    "miles",
    "moveDate",
    "dateFlexible",
    "bedrooms",
    "inventory",
    "specialItems",
    "originAccess",
    "destinationAccess",
    "packing",
    "valuationCoverage",
    "accessNotes",
    "provenance",
    "warnings",
  ],
} as const;

interface VisionExtraction {
  draft: JobSpecDraft;
  provenance: Record<string, string>;
  warnings: string[];
}

/**
 * Extracts a moving JobSpec draft from an image or PDF using OpenAI's
 * multimodal Responses API. Every nullable value is removed before schema
 * validation: missing data stays missing rather than becoming a guess.
 */
export async function extractDocumentWithVision(
  bytes: Uint8Array,
  filename: string,
  mimeType: string,
): Promise<VisionExtraction> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const dataUrl = `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`;
  const attachment =
    mimeType === "application/pdf"
      ? { type: "input_file", filename, file_data: dataUrl }
      : { type: "input_image", image_url: dataUrl, detail: "high" };

  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_VISION_MODEL ?? "gpt-4.1-mini",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: [
                "Extract only explicitly visible facts from this moving inventory, estimate, or quote.",
                "Do not infer addresses, mileage, dates, access details, quantities, prices, or services.",
                "Use null for any scalar/object that is not visible and [] for absent lists.",
                "Dates must be YYYY-MM-DD. US states must be two-letter codes.",
                "The provenance object maps each populated field path to a short exact quote from the document.",
                "Add a warning whenever text is uncertain, cropped, handwritten, or internally inconsistent.",
              ].join(" "),
            },
            attachment,
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "moving_job_spec_draft",
          strict: true,
          schema: EXTRACTION_SCHEMA,
        },
      },
    }),
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`OpenAI document extraction failed (${response.status}): ${raw.slice(0, 350)}`);
  }

  const payload = JSON.parse(raw) as {
    output_text?: string;
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  };
  const outputText =
    payload.output_text ??
    payload.output
      ?.flatMap((item) => item.content ?? [])
      .find((item) => item.type === "output_text")?.text;
  if (!outputText) throw new Error("OpenAI returned no structured document extraction");

  const extracted = JSON.parse(outputText) as Record<string, unknown> & {
    provenance?: Record<string, string>;
    warnings?: string[];
  };
  const provenance = extracted.provenance ?? {};
  const warnings = extracted.warnings ?? [];
  delete extracted.provenance;
  delete extracted.warnings;

  const withoutNulls = stripNulls(extracted) as Record<string, unknown>;
  const draft = JobSpecDraftSchema.parse({
    ...withoutNulls,
    vertical: "moving",
    source: {
      paths: ["document"],
      interviewConversationId: null,
      documentNames: [filename],
      notes: `Vision/OCR extraction from ${filename}; user confirmation required.`,
    },
  });

  return { draft, provenance, warnings };
}

function stripNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripNulls);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, child]) => child !== null)
      .map(([key, child]) => [key, stripNulls(child)]),
  );
}
