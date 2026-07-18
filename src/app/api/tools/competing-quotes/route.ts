import { NextResponse } from "next/server";
import { getCompetingQuotes } from "@/lib/orchestrator/closer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The `get_competing_quotes` client tool, called by the Closer agent mid-call.
 *
 * This endpoint is the anti-bluffing mechanism. It returns only quotes that
 * exist in the store, are complete, and carry no high-severity red flag — an
 * agent physically cannot obtain a competitor figure any other way, so an
 * invented bid has nothing to come from.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const jobId = url.searchParams.get("jobId");
  const exclude = url.searchParams.get("excludeConversationId") ?? undefined;

  if (!jobId) {
    return NextResponse.json({ error: "jobId is required" }, { status: 400 });
  }

  const quotes = await getCompetingQuotes(jobId, exclude);

  return NextResponse.json({
    count: quotes.length,
    quotes,
    usageRule:
      "You may cite these figures verbatim and attribute them to the named company. You may not state any competing price that is not in this list.",
  });
}
