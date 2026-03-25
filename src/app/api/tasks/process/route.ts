import { NextRequest } from "next/server";
import {
  handleBackgroundProcessGet,
  handleBackgroundProcessPost,
} from "@/lib/background-process-route";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return handleBackgroundProcessGet(req);
}

export async function POST(req: NextRequest) {
  return handleBackgroundProcessPost(req);
}
