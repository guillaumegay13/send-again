import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse, requireWorkspaceAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";

const BUCKET = "email-images";
const MAX_BYTES = 5 * 1024 * 1024; // keep in sync with the bucket's file_size_limit
// Reject before parsing the body. Allow some headroom over MAX_BYTES for
// multipart boundaries and the workspaceId field.
const MAX_REQUEST_BYTES = MAX_BYTES + 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
]);

const EXT_BY_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

export async function POST(req: NextRequest) {
  try {
    // Reject oversized payloads up front so we don't buffer the whole body
    // into memory before the per-file size check below.
    const contentLength = Number(req.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
      return NextResponse.json(
        { error: "Image is too large (max 5MB)" },
        { status: 413 }
      );
    }

    const form = await req.formData();
    const workspaceId = String(form.get("workspaceId") ?? "")
      .trim()
      .toLowerCase();
    if (!workspaceId) {
      return NextResponse.json(
        { error: "workspaceId is required" },
        { status: 400 }
      );
    }

    // Authenticates the caller (JWT or API key) and verifies workspace access.
    await requireWorkspaceAuth(req, workspaceId);

    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }
    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: `Unsupported image type: ${file.type || "unknown"}` },
        { status: 400 }
      );
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: "Image is too large (max 5MB)" },
        { status: 400 }
      );
    }

    const ext = EXT_BY_TYPE[file.type] ?? "bin";
    const key = `${workspaceId}/${crypto.randomUUID()}.${ext}`;
    const bytes = new Uint8Array(await file.arrayBuffer());

    const db = getDb();
    const { error: uploadError } = await db.storage
      .from(BUCKET)
      .upload(key, bytes, { contentType: file.type, upsert: false });
    if (uploadError) {
      return NextResponse.json(
        { error: `Upload failed: ${uploadError.message}` },
        { status: 502 }
      );
    }

    const { data } = db.storage.from(BUCKET).getPublicUrl(key);
    const url = data.publicUrl;
    const tag = `<img src="${url}" alt="" style="max-width:100%;height:auto;" />`;

    return NextResponse.json({ url, tag });
  } catch (error) {
    return apiErrorResponse(error, "Failed to upload image");
  }
}
