import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const { html } = (await req.json()) as { html: string };
  return new NextResponse(html ?? "", {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
