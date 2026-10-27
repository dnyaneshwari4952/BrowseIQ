import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import { LocalFileResolver } from "@/lib/local/local-file-resolver";

import { LocalFileSecurityManager } from "@/lib/local/local-file-security-manager";

export const dynamic = "force-dynamic";

/**
 * Access-controlled, read-only local file streaming endpoint (Phase 3, Section 7)
 * Serves authorized browser-compatible files to Playwright via localhost HTTP
 * without introducing desktop automation or exposing unauthorized drive paths.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const filePath = searchParams.get("path");

  if (!filePath) {
    return NextResponse.json({ error: "Missing required 'path' parameter", code: "MISSING_PATH" }, { status: 400 });
  }

  // 1. Enforce strict authorization and path traversal protection
  let permitted = false;
  let canonical: string | undefined;
  let failureReason = "Access to requested path is forbidden";
  let failureCode = "FORBIDDEN";

  // Check LocalFileSecurityManager first
  const secCheck = LocalFileSecurityManager.validatePath(filePath);
  if (secCheck.permitted && secCheck.canonicalPath) {
    permitted = true;
    canonical = secCheck.canonicalPath;
  } else {
    failureReason = secCheck.reason || failureReason;
    failureCode = secCheck.code || failureCode;

    // Check workspace fixtures via LocalFileResolver
    const resCheck = LocalFileResolver.isPermittedPath(filePath);
    if (resCheck.permitted && resCheck.canonicalPath) {
      permitted = true;
      canonical = resCheck.canonicalPath;
    }
  }

  if (!permitted || !canonical) {
    return NextResponse.json(
      { error: failureReason, code: failureCode },
      { status: 403 }
    );
  }

  // 2. Enforce existence and type check
  if (!fs.existsSync(canonical)) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  const stat = fs.statSync(canonical);
  if (!stat.isFile()) {
    return NextResponse.json({ error: "Requested resource is not a file" }, { status: 400 });
  }

  const mimeType = LocalFileResolver.getMimeType(canonical);
  const fileSize = stat.size;

  // 3. Handle Range Requests (Crucial for video and audio playback/seeking)
  const rangeHeader = request.headers.get("range");

  if (rangeHeader) {
    const parts = rangeHeader.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

    if (isNaN(start) || start >= fileSize || end >= fileSize || start > end) {
      return new NextResponse(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${fileSize}` },
      });
    }

    const chunkLength = end - start + 1;
    const fileStream = fs.createReadStream(canonical, { start, end });

    // Convert node stream to web ReadableStream
    const readable = new ReadableStream({
      start(controller) {
        fileStream.on("data", (chunk) => controller.enqueue(chunk));
        fileStream.on("end", () => controller.close());
        fileStream.on("error", (err) => controller.error(err));
      },
    });

    return new NextResponse(readable, {
      status: 206,
      headers: {
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunkLength.toString(),
        "Content-Type": mimeType,
        "Cache-Control": "no-cache",
      },
    });
  }

  // 4. Full file response
  const fileStream = fs.createReadStream(canonical);
  const readable = new ReadableStream({
    start(controller) {
      fileStream.on("data", (chunk) => controller.enqueue(chunk));
      fileStream.on("end", () => controller.close());
      fileStream.on("error", (err) => controller.error(err));
    },
  });

  return new NextResponse(readable, {
    status: 200,
    headers: {
      "Content-Type": mimeType,
      "Content-Length": fileSize.toString(),
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-cache",
    },
  });
}
