import { NextRequest } from "next/server";
import {
  handleBackgroundProcessGet,
  handleBackgroundProcessPost,
} from "@/lib/background-process-route";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return handleBackgroundProcessGet(request);
}

export async function POST(request: NextRequest) {
  return handleBackgroundProcessPost(request);
}
