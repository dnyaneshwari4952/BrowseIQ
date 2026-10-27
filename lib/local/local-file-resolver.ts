import fs from "fs";
import path from "path";
import { AgentError, ErrorCode } from "../types/errors";
import { LocalFileSecurityManager } from "./local-file-security-manager";

export interface ResolvedLocalFile {
  originalQuery: string;
  filename: string;
  canonicalPath: string;
  extension: string;
  mimeType: string;
  sizeBytes: number;
  browserUrl: string;
  isAmbiguous?: boolean;
  matchingCandidates?: string[];
}

export interface LocalFileResolverConfig {
  allowedRoots: string[];
  maxScanDepth: number;
  maxFilesScanned: number;
  maxSizeBytes: number;
}

const DEFAULT_BROWSER_EXTENSIONS: Record<string, string> = {
  // Video
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".ogg": "video/ogg",
  // Audio
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  // Image
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  // Document / Text
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".json": "application/json",
  ".csv": "text/csv",
  ".md": "text/markdown",
  ".html": "text/html",
  ".htm": "text/html",
};

/**
 * Local File Resolver (Phase 3, Section 7)
 * Provides strictly scoped, read-only local resource discovery and verification
 * without introducing desktop automation or operating system simulation.
 */
export class LocalFileResolver {
  private static config: LocalFileResolverConfig = {
    allowedRoots: [
      path.resolve(process.cwd()),
      path.resolve(process.cwd(), "public"),
      path.resolve(process.cwd(), "test-fixtures"),
      path.resolve(process.cwd(), "scratch"),
    ],
    maxScanDepth: 3,
    maxFilesScanned: 500,
    maxSizeBytes: 250 * 1024 * 1024, // 250 MB
  };

  /**
   * Configure allowed root directories.
   */
  static configure(config: Partial<LocalFileResolverConfig>): void {
    if (config.allowedRoots) {
      this.config.allowedRoots = config.allowedRoots.map((r) => {
        try {
          return fs.realpathSync(path.resolve(r));
        } catch {
          return path.resolve(r);
        }
      });
    }
    if (config.maxScanDepth !== undefined) this.config.maxScanDepth = config.maxScanDepth;
    if (config.maxFilesScanned !== undefined) this.config.maxFilesScanned = config.maxFilesScanned;
    if (config.maxSizeBytes !== undefined) this.config.maxSizeBytes = config.maxSizeBytes;
  }

  /**
   * Get current allowed roots.
   */
  static getAllowedRoots(): string[] {
    return [...this.config.allowedRoots];
  }

  /**
   * Check whether a file extension is supported by modern browsers.
   */
  static isBrowserCompatible(filename: string): boolean {
    const ext = path.extname(filename).toLowerCase();
    return Boolean(DEFAULT_BROWSER_EXTENSIONS[ext]);
  }

  /**
   * Get MIME type for a browser-compatible extension.
   */
  static getMimeType(filename: string): string {
    const ext = path.extname(filename).toLowerCase();
    return DEFAULT_BROWSER_EXTENSIONS[ext] || "application/octet-stream";
  }

  /**
   * Verifies whether a given path is within permitted search roots and does not traverse outside.
   */
  static isPermittedPath(candidatePath: string): { permitted: boolean; canonicalPath?: string; reason?: string } {
    try {
      // Check LocalFileSecurityManager (user approved local directory)
      if (LocalFileSecurityManager.isEnabled()) {
        const secCheck = LocalFileSecurityManager.validatePath(candidatePath);
        if (secCheck.permitted && secCheck.canonicalPath) {
          return { permitted: true, canonicalPath: secCheck.canonicalPath };
        }
      }

      const cleanPath = candidatePath.replace(/^file:\/\/\/?/i, "").replace(/^[a-zA-Z]:[\\/]/, (match) => match);
      const resolved = path.resolve(cleanPath);

      // 1. Initial path boundary check (catches .. traversal and unauthorized drive access)
      const isWithinRoot = this.config.allowedRoots.some((root) => {
        const canonicalRoot = fs.existsSync(root) ? fs.realpathSync(root) : path.resolve(root);
        const relative = path.relative(canonicalRoot, resolved);
        return !relative.startsWith("..") && !path.isAbsolute(relative);
      });

      if (!isWithinRoot) {
        return {
          permitted: false,
          reason: `Access denied: Path '${candidatePath}' is outside authorized search roots.`,
        };
      }

      // 2. Check existence & resolve canonical path (resolves symlinks)
      if (!fs.existsSync(resolved)) {
        return { permitted: false, reason: `Path does not exist: '${candidatePath}'` };
      }

      const canonical = fs.realpathSync(resolved);
      const isCanonicalWithinRoot = this.config.allowedRoots.some((root) => {
        const canonicalRoot = fs.existsSync(root) ? fs.realpathSync(root) : path.resolve(root);
        const relative = path.relative(canonicalRoot, canonical);
        return !relative.startsWith("..") && !path.isAbsolute(relative);
      });

      if (!isCanonicalWithinRoot) {
        return {
          permitted: false,
          reason: `Access denied: Path '${canonical}' is outside authorized search roots.`,
        };
      }

      return { permitted: true, canonicalPath: canonical };
    } catch (err) {
      return {
        permitted: false,
        reason: `Error validating path: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /**
   * Resolves a local file from a natural language query or path.
   * Enforces existence, type compatibility, access boundaries, and ambiguity resolution.
   */
  static async resolveFile(input: {
    pathOrName: string;
    searchDirectory?: string;
    serverBaseUrl?: string;
  }): Promise<ResolvedLocalFile> {
    const { pathOrName, searchDirectory, serverBaseUrl = "http://localhost:3000" } = input;
    const trimmed = pathOrName.trim();

    if (!trimmed) {
      throw new AgentError("Empty file path or name provided", ErrorCode.VALIDATION_FAILED, false);
    }

    // 1. Direct path check
    let directCandidate = trimmed;
    if (trimmed.startsWith("file://")) {
      directCandidate = decodeURIComponent(trimmed.replace(/^file:\/\/\/?/i, ""));
    }

    const isDirectPath =
      path.isAbsolute(directCandidate) ||
      directCandidate.startsWith("./") ||
      directCandidate.startsWith(".\\") ||
      directCandidate.includes("/") ||
      directCandidate.includes("\\");

    if (isDirectPath) {
      const baseDir = searchDirectory || this.config.allowedRoots[0] || process.cwd();
      const targetPath = path.isAbsolute(directCandidate)
        ? directCandidate
        : path.resolve(baseDir, directCandidate);

      const check = this.isPermittedPath(targetPath);
      if (!check.permitted || !check.canonicalPath) {
        throw new AgentError(
          check.reason || `Access denied or invalid path: '${pathOrName}'`,
          ErrorCode.VALIDATION_FAILED,
          false,
          { targetPath }
        );
      }

      const stat = fs.statSync(check.canonicalPath);
      if (!stat.isFile()) {
        throw new AgentError(
          `Target path '${check.canonicalPath}' is a directory, not a regular file.`,
          ErrorCode.VALIDATION_FAILED,
          false
        );
      }

      if (stat.size > this.config.maxSizeBytes) {
        throw new AgentError(
          `File size (${(stat.size / (1024 * 1024)).toFixed(1)}MB) exceeds maximum permitted limit (${this.config.maxSizeBytes / (1024 * 1024)}MB).`,
          ErrorCode.VALIDATION_FAILED,
          false
        );
      }

      const ext = path.extname(check.canonicalPath).toLowerCase();
      if (!this.isBrowserCompatible(check.canonicalPath)) {
        throw new AgentError(
          `File format '${ext}' is not supported for direct browser rendering. Supported formats: ${Object.keys(DEFAULT_BROWSER_EXTENSIONS).join(", ")}`,
          ErrorCode.VALIDATION_FAILED,
          false
        );
      }

      const filename = path.basename(check.canonicalPath);
      const encodedPath = encodeURIComponent(check.canonicalPath);
      const browserUrl = `${serverBaseUrl}/api/local-file?path=${encodedPath}`;

      return {
        originalQuery: pathOrName,
        filename,
        canonicalPath: check.canonicalPath,
        extension: ext,
        mimeType: this.getMimeType(filename),
        sizeBytes: stat.size,
        browserUrl,
      };
    }

    // 2. Resource Discovery (Name-only search within authorized roots)
    const matches = await this.findMatchingFiles(trimmed, searchDirectory);

    if (matches.length === 0) {
      throw new AgentError(
        `File '${trimmed}' was not found in authorized local search roots.`,
        ErrorCode.ELEMENT_NOT_FOUND,
        false,
        { query: trimmed, allowedRoots: this.config.allowedRoots }
      );
    }

    if (matches.length > 1) {
      // Ambiguous matches found
      const candidatePaths = matches.map((m) => m.canonicalPath);
      throw new AgentError(
        `Multiple matching files found for '${trimmed}' (${matches.length} matches). Please specify the directory or exact path.`,
        ErrorCode.ELEMENT_AMBIGUOUS,
        false,
        { candidates: candidatePaths }
      );
    }

    return matches[0];
  }

  /**
   * Bounded discovery for a filename within authorized roots.
   */
  static async findMatchingFiles(nameQuery: string, searchRoot?: string): Promise<ResolvedLocalFile[]> {
    const rootsToSearch = searchRoot
      ? [path.resolve(searchRoot)]
      : this.config.allowedRoots;

    const results: ResolvedLocalFile[] = [];
    const lowerQuery = nameQuery.toLowerCase().trim();
    let totalScanned = 0;

    for (const root of rootsToSearch) {
      const check = this.isPermittedPath(root);
      if (!check.permitted || !check.canonicalPath) continue;

      const scanDir = (dir: string, depth: number) => {
        if (depth > this.config.maxScanDepth || totalScanned > this.config.maxFilesScanned) {
          return;
        }

        let entries: fs.Dirent[] = [];
        try {
          entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
          return;
        }

        for (const entry of entries) {
          totalScanned++;
          if (totalScanned > this.config.maxFilesScanned) return;

          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            // Avoid scanning node_modules, .git, or hidden folders
            if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === ".next") {
              continue;
            }
            scanDir(fullPath, depth + 1);
          } else if (entry.isFile()) {
            const entryLower = entry.name.toLowerCase();
            const matchesQuery =
              entryLower === lowerQuery ||
              path.parse(entryLower).name === path.parse(lowerQuery).name ||
              entryLower.includes(lowerQuery);

            if (matchesQuery && this.isBrowserCompatible(entry.name)) {
              try {
                const canonical = fs.realpathSync(fullPath);
                const stat = fs.statSync(canonical);
                if (stat.size <= this.config.maxSizeBytes) {
                  const ext = path.extname(canonical).toLowerCase();
                  const encodedPath = encodeURIComponent(canonical);
                  results.push({
                    originalQuery: nameQuery,
                    filename: entry.name,
                    canonicalPath: canonical,
                    extension: ext,
                    mimeType: this.getMimeType(entry.name),
                    sizeBytes: stat.size,
                    browserUrl: `http://localhost:3000/api/local-file?path=${encodedPath}`,
                  });
                }
              } catch {
                // Ignore inaccessible file
              }
            }
          }
        }
      };

      scanDir(check.canonicalPath, 0);
    }

    return results;
  }
}
