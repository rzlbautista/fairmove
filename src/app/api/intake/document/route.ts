import { NextResponse } from "next/server";
import { parseDocument, mergeDrafts } from "@/lib/extract/documentIntake";
import { extractDocumentWithVision } from "@/lib/extract/visionIntake";
import { missingRequiredFields } from "@/lib/domain/jobspec";
import { loadVertical } from "@/lib/config/vertical";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Document intake. Accepts a multipart upload or a raw text body and returns a
 * JobSpec draft in the SAME shape the voice interview produces, plus the
 * provenance of every field it filled and an explicit list of what is missing.
 *
 * Nothing here is inferred silently — an unreadable field stays undefined so
 * the confirmation screen asks the user rather than guessing.
 */
export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  let text = "";
  let filename = "document.txt";
  let existingDraft: unknown = null;

  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "No file field in upload" }, { status: 400 });
      }
      filename = file.name || filename;

      if (/\.(png|jpe?g|webp|heic|pdf)$/i.test(filename)) {
        if (!process.env.OPENAI_API_KEY) {
          return NextResponse.json(
            {
              error: `${filename} needs vision/OCR. Set OPENAI_API_KEY, or upload/paste a text inventory.`,
              needsOcr: true,
            },
            { status: 503 },
          );
        }
        const bytes = new Uint8Array(await file.arrayBuffer());
        const mimeType =
          file.type ||
          (filename.toLowerCase().endsWith(".pdf") ? "application/pdf" : "image/jpeg");
        const extracted = await extractDocumentWithVision(bytes, filename, mimeType);
        const draftField = form.get("draft");
        if (typeof draftField === "string") existingDraft = JSON.parse(draftField);
        const draft = existingDraft
          ? mergeDrafts(extracted.draft, existingDraft as Parameters<typeof mergeDrafts>[1])
          : extracted.draft;
        const config = loadVertical();
        return NextResponse.json({
          draft,
          provenance: extracted.provenance,
          missing: missingRequiredFields(draft, config.jobSpecTaxonomy.requiredFields),
          warnings: extracted.warnings,
          itemCount: draft.inventory?.length ?? 0,
          requiredFields: config.jobSpecTaxonomy.requiredFields,
          ocr: true,
        });
      }
      text = await file.text();
      const draftField = form.get("draft");
      if (typeof draftField === "string") existingDraft = JSON.parse(draftField);
    } else {
      const body = await request.json();
      text = body.text ?? "";
      filename = body.filename ?? filename;
      existingDraft = body.draft ?? null;
    }
  } catch (err) {
    return NextResponse.json({ error: `Could not read upload: ${String(err).slice(0, 200)}` }, { status: 400 });
  }

  if (!text.trim()) {
    return NextResponse.json({ error: "Document was empty" }, { status: 400 });
  }

  const config = loadVertical();
  const result = parseDocument(text, filename);

  // If a voice draft already exists, the two paths converge here.
  const draft = existingDraft
    ? mergeDrafts(result.draft, existingDraft as Parameters<typeof mergeDrafts>[1])
    : result.draft;

  return NextResponse.json({
    draft,
    provenance: result.provenance,
    missing: result.missing,
    warnings: result.warnings,
    itemCount: result.draft.inventory?.length ?? 0,
    requiredFields: config.jobSpecTaxonomy.requiredFields,
  });
}
