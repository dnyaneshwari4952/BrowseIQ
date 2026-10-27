import { NextRequest, NextResponse } from "next/server";
import { LocalFileSecurityManager, LocalAccessMode } from "@/lib/local/local-file-security-manager";

export const dynamic = "force-dynamic";

/**
 * Local File Permission Endpoint (Requirements 1 & 5)
 * Controls user permission state, access mode (Selected Folders vs Whole Computer),
 * and authorized directories.
 */
export async function GET() {
  const status = LocalFileSecurityManager.getPermissionStatus();
  return NextResponse.json(status);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      enabled,
      accessMode,
      wholeComputerConfirmed,
      approvedDirectories,
      approvedDirectory,
    } = body;

    const current = LocalFileSecurityManager.getPermissionStatus();
    const newEnabled = typeof enabled === "boolean" ? enabled : current.enabled;

    LocalFileSecurityManager.setPermission(newEnabled, {
      accessMode: accessMode as LocalAccessMode | undefined,
      wholeComputerConfirmed: typeof wholeComputerConfirmed === "boolean" ? wholeComputerConfirmed : undefined,
      approvedDirectories: Array.isArray(approvedDirectories) ? approvedDirectories : undefined,
      directory: typeof approvedDirectory === "string" ? approvedDirectory : undefined,
    });

    const updated = LocalFileSecurityManager.getPermissionStatus();
    return NextResponse.json(updated);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Failed to update permission" },
      { status: 400 }
    );
  }
}
