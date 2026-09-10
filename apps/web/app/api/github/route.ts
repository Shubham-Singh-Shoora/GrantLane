import { NextResponse } from "next/server";
import { fetchRepoSnapshot } from "@/lib/github";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Live repo lookup for the application form, so the applicant sees what the reviewer will. */
export async function GET(request: Request) {
  const url = new URL(request.url).searchParams.get("url");
  if (!url) {
    return NextResponse.json({ error: "missing_url" }, { status: 400 });
  }

  const lookup = await fetchRepoSnapshot(url);
  if (!lookup.ok) {
    return NextResponse.json({ error: lookup.code, detail: lookup.detail }, { status: 400 });
  }

  return NextResponse.json({ repo: lookup.snapshot }, { headers: { "Cache-Control": "no-store" } });
}
