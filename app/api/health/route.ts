import { NextResponse } from "next/server";
import { provider } from "@/lib/providers";

/** Lets the dashboard warn about setup before a student hits a 500 mid-upload. */
export async function GET() {
  const p = provider();
  const h = p.health();
  return NextResponse.json({ provider: p.name, ...h });
}
