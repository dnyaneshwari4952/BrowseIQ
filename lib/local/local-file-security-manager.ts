import fs from "fs";
import path from "path";
import os from "os";

export type LocalAccessMode = "selected_folders" | "whole_computer";

export interface AudioFileCandidate {
  filename: string;
  canonicalPath: string;
  relativePath: string;
  extension: string;
  mimeType: string;
  sizeBytes: number;
  score: number;
  directory?: string;
}

export interface LocalAudioSearchResult {
  query: string;
  found: boolean;
  bestMatch?: AudioFileCandidate;
  candidates: AudioFileCandidate[];
  isAmbiguous: boolean;
  searchedDirectory: string;
  searchedLocations?: string[];
  scannedCount?: number;
  durationMs?: number;
}

export interface FileCandidate {
  filename: string;
  canonicalPath: string;
  relativePath: string;
  extension: string;
  mimeType?: string;
  sizeBytes: number;
  score: number;
  directory: string;
}

export interface LocalFileSearchResult {
  query: string;
  found: boolean;
  bestMatch?: FileCandidate;
  candidates: FileCandidate[];
  isAmbiguous: boolean;
  searchedLocations: string[];
  scannedCount: number;
  timedOut: boolean;
  durationMs: number;
}

export interface FileSearchOptions {
  query: string;
  extensions?: string[];
  locations?: string[];
  maxDepth?: number;
  maxFiles?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  stopOnExactMatch?: boolean;
}

export interface UserLibraryDirectories {
  downloads: string;
  documents: string;
  desktop: string;
  music: string;
  videos: string;
}

export interface LocalFilePermissionStatus {
  enabled: boolean;
  accessMode: LocalAccessMode;
  approvedDirectory: string; // Backward compatibility with previous single directory
  approvedDirectories: string[];
  defaultDirectory: string;
  userLibraryDirectories: UserLibraryDirectories;
  wholeComputerConfirmed: boolean;
  exists: boolean;
  resolvedCanonicalPath?: string;
  isReadOnly: boolean;
}

const SUPPORTED_AUDIO_EXTENSIONS: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
};

interface GlobalSecurityState {
  enabled: boolean;
  accessMode: LocalAccessMode;
  wholeComputerConfirmed: boolean;
  approvedDirectories: string[];
}

const GLOBAL_STATE_KEY = "__LOCAL_FILE_SECURITY_STATE__";

function safeJoin(base: string, ...segments: string[]): string {
  // Prevent @vercel/nft build tracer from statically globbing runtime user directories as assets
  return [base, ...segments].join(path.sep);
}

function getRuntimeHomeDir(): string {
  // Use runtime dynamic lookup to prevent @vercel/nft build-time AST tracer
  // from statically evaluating os.homedir() and globbing the entire user home directory
  const method = "homedir";
  return (os as any)[method]();
}

function getGlobalSecurityState(): GlobalSecurityState {
  const g = globalThis as any;
  if (!g[GLOBAL_STATE_KEY]) {
    const defaultDir = safeJoin(getRuntimeHomeDir(), "Downloads");
    const state: GlobalSecurityState = {
      enabled: false,
      accessMode: "selected_folders",
      wholeComputerConfirmed: false,
      approvedDirectories: [defaultDir],
    };
    try {
      const configPath = path.resolve(process.cwd(), "scratch", "local-file-permission.json");
      if (fs.existsSync(configPath)) {
        const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        if (typeof raw.enabled === "boolean") state.enabled = raw.enabled;
        if (raw.accessMode === "selected_folders" || raw.accessMode === "whole_computer") {
          state.accessMode = raw.accessMode;
        }
        if (typeof raw.wholeComputerConfirmed === "boolean") {
          state.wholeComputerConfirmed = raw.wholeComputerConfirmed;
        }
        if (Array.isArray(raw.approvedDirectories) && raw.approvedDirectories.length > 0) {
          state.approvedDirectories = raw.approvedDirectories.map((d: string) => path.resolve(d.trim()));
        } else if (typeof raw.approvedDirectory === "string" && raw.approvedDirectory.trim()) {
          state.approvedDirectories = [path.resolve(raw.approvedDirectory.trim())];
        }
      }
    } catch {}
    g[GLOBAL_STATE_KEY] = state;
  }
  return g[GLOBAL_STATE_KEY];
}

function persistGlobalSecurityState(state: GlobalSecurityState): void {
  try {
    const scratchDir = path.resolve(process.cwd(), "scratch");
    if (!fs.existsSync(scratchDir)) {
      fs.mkdirSync(scratchDir, { recursive: true });
    }
    const configPath = path.join(scratchDir, "local-file-permission.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify(
        {
          ...state,
          approvedDirectory: state.approvedDirectories[0] || safeJoin(getRuntimeHomeDir(), "Downloads"),
        },
        null,
        2
      ),
      "utf-8"
    );
  } catch {}
}

/**
 * Local File Security Manager
 * Implements strict, read-only local filesystem permission,
 * path traversal protection, symlink escape detection, and audio file search.
 * Supports both Selected Folders and Whole-Computer access modes with safety boundaries.
 */
export class LocalFileSecurityManager {
  // Directory names strictly excluded from scanning and file access
  private static readonly SENSITIVE_DIR_NAMES = new Set([
    "windows",
    "program files",
    "program files (x86)",
    "programdata",
    "recovery",
    "$recycle.bin",
    "system volume information",
    "appdata",
    ".ssh",
    ".aws",
    ".azure",
    ".kube",
    ".gnupg",
    ".config",
    ".git",
    ".gemini",
    "node_modules",
    "credentials",
  ]);

  // Sensitive file names and patterns that must never be read or opened
  private static readonly SENSITIVE_FILE_NAMES = new Set([
    "id_rsa",
    "id_ed25519",
    "id_dsa",
    "id_ecdsa",
    "ntuser.dat",
    "usrclass.dat",
    "pagefile.sys",
    "hiberfil.sys",
    "swapfile.sys",
  ]);

  private static readonly SENSITIVE_EXTENSIONS = new Set([
    ".pem",
    ".key",
    ".pfx",
    ".p12",
    ".kdbx",
  ]);

  public static get enabled(): boolean {
    return getGlobalSecurityState().enabled;
  }

  public static set enabled(val: boolean) {
    const s = getGlobalSecurityState();
    s.enabled = val;
    persistGlobalSecurityState(s);
  }

  public static get accessMode(): LocalAccessMode {
    return getGlobalSecurityState().accessMode;
  }

  public static set accessMode(val: LocalAccessMode) {
    const s = getGlobalSecurityState();
    s.accessMode = val;
    persistGlobalSecurityState(s);
  }

  public static get wholeComputerConfirmed(): boolean {
    return getGlobalSecurityState().wholeComputerConfirmed;
  }

  public static set wholeComputerConfirmed(val: boolean) {
    const s = getGlobalSecurityState();
    s.wholeComputerConfirmed = val;
    persistGlobalSecurityState(s);
  }

  public static get approvedDirectories(): string[] {
    const s = getGlobalSecurityState();
    if (!s.approvedDirectories || s.approvedDirectories.length === 0) {
      s.approvedDirectories = [this.getDefaultDownloadsDirectory()];
    }
    return [...s.approvedDirectories];
  }

  public static set approvedDirectories(dirs: string[]) {
    const s = getGlobalSecurityState();
    s.approvedDirectories = dirs.map((d) => path.resolve(d.trim()));
    persistGlobalSecurityState(s);
  }

  /**
   * Backward-compatibility accessor for single approved directory.
   */
  public static get approvedDirectory(): string {
    const dirs = this.approvedDirectories;
    return dirs[0] || this.getDefaultDownloadsDirectory();
  }

  public static set approvedDirectory(val: string) {
    if (val && typeof val === "string" && val.trim().length > 0) {
      this.approvedDirectories = [path.resolve(val.trim())];
    }
  }

  /**
   * Resolves the default user Downloads directory safely using Node.js os API.
   * Never hardcodes usernames or drives.
   */
  public static getDefaultDownloadsDirectory(): string {
    return safeJoin(getRuntimeHomeDir(), "Downloads");
  }

  /**
   * Resolves standard Windows user library directories dynamically.
   */
  public static getUserLibraryDirectories(): UserLibraryDirectories {
    const home = getRuntimeHomeDir();
    return {
      downloads: safeJoin(home, "Downloads"),
      documents: safeJoin(home, "Documents"),
      desktop: safeJoin(home, "Desktop"),
      music: safeJoin(home, "Music"),
      videos: safeJoin(home, "Videos"),
    };
  }

  /**
   * Returns list of existing filesystem drives on Windows (or root on POSIX).
   */
  public static getAccessibleDrives(): string[] {
    if (process.platform === "win32") {
      const drives: string[] = [];
      for (const letter of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
        const root = `${letter}:\\`;
        try {
          if (fs.existsSync(root)) {
            drives.push(root);
          }
        } catch {}
      }
      return drives.length > 0 ? drives : ["C:\\"];
    }
    return ["/"];
  }

  /**
   * Returns current permission status and approved directory details.
   */
  public static getPermissionStatus(): LocalFilePermissionStatus {
    const defaultDir = this.getDefaultDownloadsDirectory();
    const primaryDir = this.approvedDirectory;
    let exists = false;
    let resolvedCanonical: string | undefined;

    try {
      if (fs.existsSync(primaryDir)) {
        exists = true;
        resolvedCanonical = fs.realpathSync(primaryDir);
      }
    } catch {
      exists = false;
    }

    return {
      enabled: this.enabled,
      accessMode: this.accessMode,
      approvedDirectory: primaryDir,
      approvedDirectories: this.approvedDirectories,
      defaultDirectory: defaultDir,
      userLibraryDirectories: this.getUserLibraryDirectories(),
      wholeComputerConfirmed: this.wholeComputerConfirmed,
      exists,
      resolvedCanonicalPath: resolvedCanonical,
      isReadOnly: true,
    };
  }

  /**
   * Sets permission state and options.
   */
  public static setPermission(
    enabled: boolean,
    directoryOrOptions?:
      | string
      | {
          accessMode?: LocalAccessMode;
          wholeComputerConfirmed?: boolean;
          approvedDirectories?: string[];
          directory?: string;
        }
  ): LocalFilePermissionStatus {
    const state = getGlobalSecurityState();
    state.enabled = enabled;

    if (typeof directoryOrOptions === "string") {
      if (directoryOrOptions.trim().length > 0) {
        state.approvedDirectories = [path.resolve(directoryOrOptions.trim())];
      }
    } else if (directoryOrOptions && typeof directoryOrOptions === "object") {
      if (directoryOrOptions.accessMode) {
        state.accessMode = directoryOrOptions.accessMode;
      }
      if (typeof directoryOrOptions.wholeComputerConfirmed === "boolean") {
        state.wholeComputerConfirmed = directoryOrOptions.wholeComputerConfirmed;
      }
      if (Array.isArray(directoryOrOptions.approvedDirectories)) {
        state.approvedDirectories = directoryOrOptions.approvedDirectories.map((d) => path.resolve(d.trim()));
      } else if (directoryOrOptions.directory) {
        state.approvedDirectories = [path.resolve(directoryOrOptions.directory.trim())];
      }
    }

    persistGlobalSecurityState(state);
    return this.getPermissionStatus();
  }

  /**
   * Enables local files permission.
   */
  public static enable(
    directoryOrOptions?:
      | string
      | {
          accessMode?: LocalAccessMode;
          wholeComputerConfirmed?: boolean;
          approvedDirectories?: string[];
        }
  ): void {
    if (typeof directoryOrOptions === "string") {
      this.setPermission(true, {
        directory: directoryOrOptions,
        accessMode: "selected_folders",
      });
    } else {
      this.setPermission(true, {
        accessMode: directoryOrOptions?.accessMode || "selected_folders",
        ...directoryOrOptions,
      });
    }
  }

  /**
   * Enables whole-computer access explicitly with confirmation.
   */
  public static enableWholeComputer(confirmed: boolean = true): LocalFilePermissionStatus {
    return this.setPermission(true, {
      accessMode: "whole_computer",
      wholeComputerConfirmed: confirmed,
    });
  }

  /**
   * Disables local files permission.
   */
  public static disable(): void {
    this.setPermission(false);
  }

  /**
   * Checks whether local file access is currently enabled.
   */
  public static isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Gets the active access mode.
   */
  public static getAccessMode(): LocalAccessMode {
    return this.accessMode;
  }

  /**
   * Gets the currently approved primary directory.
   */
  public static getApprovedDirectory(): string {
    return this.approvedDirectory;
  }

  /**
   * Gets all approved directories.
   */
  public static getApprovedDirectories(): string[] {
    return this.approvedDirectories;
  }

  /**
   * Evaluates whether a given path falls within a protected, sensitive, or system directory.
   */
  public static isSensitivePath(candidatePath: string): { sensitive: boolean; reason?: string } {
    if (!candidatePath || typeof candidatePath !== "string") {
      return { sensitive: true, reason: "Empty or invalid path" };
    }

    const norm = path.resolve(candidatePath).toLowerCase();
    const parsed = path.parse(norm);
    const baseName = parsed.base.toLowerCase();
    const ext = parsed.ext.toLowerCase();

    // Sensitive files
    if (this.SENSITIVE_FILE_NAMES.has(baseName) || baseName.startsWith("ntuser.dat") || baseName.startsWith(".env")) {
      return {
        sensitive: true,
        reason: `Access denied: '${baseName}' is a protected system or credential file.`,
      };
    }

    // Sensitive extensions
    if (this.SENSITIVE_EXTENSIONS.has(ext)) {
      return {
        sensitive: true,
        reason: `Access denied: File extension '${ext}' contains sensitive keys or credentials.`,
      };
    }

    // Path segments check
    const segments = norm.split(path.sep).filter(Boolean);
    for (const seg of segments) {
      if (this.SENSITIVE_DIR_NAMES.has(seg)) {
        return {
          sensitive: true,
          reason: `Access denied: Directory segment '${seg}' is a protected system or private credential directory.`,
        };
      }
    }

    // Browser user data profiles check
    if (norm.includes("google\\chrome\\user data") || norm.includes("mozilla\\firefox\\profiles") || norm.includes("microsoft\\edge\\user data")) {
      return {
        sensitive: true,
        reason: "Access denied: Browser user profile and credential stores are protected.",
      };
    }

    // Check canonical realpath if candidate exists
    try {
      if (fs.existsSync(candidatePath)) {
        const canonical = fs.realpathSync(candidatePath).toLowerCase();
        const canonicalSegments = canonical.split(path.sep).filter(Boolean);
        for (const seg of canonicalSegments) {
          if (this.SENSITIVE_DIR_NAMES.has(seg)) {
            return {
              sensitive: true,
              reason: `Access denied: Canonical target directory '${seg}' is protected.`,
            };
          }
        }
      }
    } catch {}

    return { sensitive: false };
  }

  /**
   * Validates that a candidate file path is permitted:
   * 1. Local storage permission must be enabled.
   * 2. Candidate must not be within protected system or credential directories.
   * 3. Candidate must exist on disk and be a regular file.
   * 4. In 'selected_folders' mode: must reside strictly within at least one approved folder.
   * 5. In 'whole_computer' mode: must reside on an accessible drive and pass sensitive path checks.
   * 6. Rejects path traversal (..) and symlinks escaping boundaries into sensitive or unauthorized paths.
   */
  public static validatePath(candidatePath: string): {
    permitted: boolean;
    canonicalPath?: string;
    reason?: string;
    code?: string;
  } {
    if (!this.enabled) {
      return {
        permitted: false,
        code: "LOCAL_PERMISSION_REQUIRED",
        reason: "Local file access is disabled. Please enable Local Files permission in Settings to proceed.",
      };
    }

    if (!candidatePath || typeof candidatePath !== "string") {
      return {
        permitted: false,
        code: "INVALID_PATH",
        reason: "Invalid or empty path specified.",
      };
    }

    // Strip file:// prefix if present
    const cleanPath = decodeURIComponent(candidatePath.replace(/^file:\/\/\/?/i, ""));

    // Check path traversal syntax upfront
    if (cleanPath.includes("..")) {
      return {
        permitted: false,
        code: "PATH_TRAVERSAL_DETECTED",
        reason: `Access denied: Path "${candidatePath}" contains relative traversal segments ('..'). Traversal is strictly prohibited.`,
      };
    }

    // Check sensitive paths upfront
    const sensitiveCheck = this.isSensitivePath(cleanPath);
    if (sensitiveCheck.sensitive) {
      return {
        permitted: false,
        code: "SENSITIVE_DIRECTORY_EXCLUDED",
        reason: sensitiveCheck.reason || "Access denied: Target path resides within a protected system or sensitive directory.",
      };
    }

    // Selected folders mode validation
    if (this.accessMode === "selected_folders") {
      const approvedDirs = this.approvedDirectories;
      if (approvedDirs.length === 0) {
        return {
          permitted: false,
          code: "APPROVED_DIR_NOT_FOUND",
          reason: "No approved directories are currently configured.",
        };
      }

      // Check if none of the approved directories exist
      const anyApprovedExists = approvedDirs.some((d) => fs.existsSync(d));
      if (!anyApprovedExists) {
        return {
          permitted: false,
          code: "APPROVED_DIR_NOT_FOUND",
          reason: `Approved local directory does not exist: "${approvedDirs[0]}".`,
        };
      }

      // Resolve candidate path
      let resolvedCandidate: string;
      if (path.isAbsolute(cleanPath)) {
        resolvedCandidate = path.resolve(cleanPath);
      } else {
        // Resolve relative to primary approved directory
        resolvedCandidate = path.resolve(approvedDirs[0], cleanPath);
      }

      // Check for path traversal syntax
      const isExplicitTraversal = cleanPath.includes("..") || path.isAbsolute(cleanPath);
      let isWithinAnyApproved = false;
      for (const dir of approvedDirs) {
        if (!fs.existsSync(dir)) continue;
        const rel = path.relative(path.resolve(dir), resolvedCandidate);
        if (!rel.startsWith("..") && !path.isAbsolute(rel)) {
          isWithinAnyApproved = true;
          break;
        }
      }

      if (isExplicitTraversal && !isWithinAnyApproved) {
        return {
          permitted: false,
          code: "PATH_TRAVERSAL_DETECTED",
          reason: `Access denied: File "${candidatePath}" is outside approved directory "${this.approvedDirectory}". Path traversal is strictly prohibited.`,
        };
      }

      // Check existence of target
      if (!fs.existsSync(resolvedCandidate)) {
        return {
          permitted: false,
          code: "FILE_NOT_FOUND",
          reason: `File not found at resolved path: "${resolvedCandidate}".`,
        };
      }

      // Resolve canonical path of candidate
      let canonicalCandidate: string;
      try {
        canonicalCandidate = fs.realpathSync(resolvedCandidate);
      } catch (err: any) {
        return {
          permitted: false,
          code: "CANONICAL_RESOLVE_FAILED",
          reason: `Failed to resolve real path: ${err.message}`,
        };
      }

      // Canonical sensitive check
      const canonicalSensitive = this.isSensitivePath(canonicalCandidate);
      if (canonicalSensitive.sensitive) {
        return {
          permitted: false,
          code: "SENSITIVE_DIRECTORY_EXCLUDED",
          reason: canonicalSensitive.reason,
        };
      }

      // Verify canonical candidate resides strictly inside at least one approved directory
      let residesInApproved = false;
      let matchedApprovedDir = "";

      for (const approvedDir of approvedDirs) {
        if (!fs.existsSync(approvedDir)) continue;
        try {
          const canonicalApproved = fs.realpathSync(approvedDir);

          // Check initial unresolved traversal
          const initialRel = path.relative(canonicalApproved, resolvedCandidate);
          if (initialRel.startsWith("..") || path.isAbsolute(initialRel)) {
            continue;
          }

          // Check canonical realpath
          const canonicalRel = path.relative(canonicalApproved, canonicalCandidate);
          if (!canonicalRel.startsWith("..") && !path.isAbsolute(canonicalRel)) {
            residesInApproved = true;
            matchedApprovedDir = approvedDir;
            break;
          }
        } catch {}
      }

      if (!residesInApproved) {
        // Distinguish between obvious .. path traversal and symlink escape
        const isTraversal = cleanPath.includes("..") || path.isAbsolute(cleanPath);
        return {
          permitted: false,
          code: isTraversal ? "PATH_TRAVERSAL_DETECTED" : "SYMLINK_ESCAPE_DETECTED",
          reason: `Access denied: File "${candidatePath}" is outside approved directory "${this.approvedDirectory}". Symbolic link and junction escapes are strictly prohibited.`,
        };
      }

      // Regular file check
      try {
        const stat = fs.statSync(canonicalCandidate);
        if (!stat.isFile()) {
          return {
            permitted: false,
            code: "NOT_A_FILE",
            reason: `Target path "${canonicalCandidate}" is not a regular file.`,
          };
        }
      } catch (err: any) {
        return {
          permitted: false,
          code: "STAT_FAILED",
          reason: `Could not inspect file attributes: ${err.message}`,
        };
      }

      return {
        permitted: true,
        canonicalPath: canonicalCandidate,
      };
    }

    // Whole computer mode validation
    if (!this.wholeComputerConfirmed) {
      return {
        permitted: false,
        code: "WHOLE_COMPUTER_CONFIRMATION_REQUIRED",
        reason: "Whole-computer access mode requires explicit user confirmation in Settings before access is granted.",
      };
    }

    const resolvedCandidate = path.resolve(cleanPath);
    if (!fs.existsSync(resolvedCandidate)) {
      return {
        permitted: false,
        code: "FILE_NOT_FOUND",
        reason: `File not found at resolved path: "${resolvedCandidate}".`,
      };
    }

    let canonicalCandidate: string;
    try {
      canonicalCandidate = fs.realpathSync(resolvedCandidate);
    } catch (err: any) {
      return {
        permitted: false,
        code: "CANONICAL_RESOLVE_FAILED",
        reason: `Failed to resolve real path: ${err.message}`,
      };
    }

    const canonicalSensitive = this.isSensitivePath(canonicalCandidate);
    if (canonicalSensitive.sensitive) {
      return {
        permitted: false,
        code: "SENSITIVE_DIRECTORY_EXCLUDED",
        reason: canonicalSensitive.reason,
      };
    }

    try {
      const stat = fs.statSync(canonicalCandidate);
      if (!stat.isFile()) {
        return {
          permitted: false,
          code: "NOT_A_FILE",
          reason: `Target path "${canonicalCandidate}" is not a regular file.`,
        };
      }
    } catch (err: any) {
      return {
        permitted: false,
        code: "STAT_FAILED",
        reason: `Could not inspect file attributes: ${err.message}`,
      };
    }

    return {
      permitted: true,
      canonicalPath: canonicalCandidate,
    };
  }

  /**
   * Normalizes a song or audio title for reliable matching against filenames.
   */
  public static normalizeTitle(title: string): string {
    const stripped = title
      .toLowerCase()
      .replace(
        /\b(?:from\s+downloads\s+folder|from\s+downloads|from\s+local\s+storage|from\s+local|from\s+desktop|from\s+documents|from\s+music|from\s+computer|on\s+my\s+computer|on\s+computer|on\s+this\s+pc|on\s+desktop|in\s+downloads|in\s+music|in\s+documents|in\s+videos|downloads\s+folder|local\s+storage|local\s+disk|whole\s+computer)\b/gi,
        ""
      )
      .replace(/\b(?:play|stream|listen(?:\s+to)?|search(?:\s+for)?|find|open)\b/gi, "")
      .replace(/\b(?:song|track|audio|music|mp3|wav|file)\b/gi, "")
      .replace(/[_\W]+/g, " ") // Replace punctuation and underscores with space
      .replace(/\s+/g, " ")
      .trim();

    if (stripped.length > 0) {
      return stripped;
    }

    return title
      .toLowerCase()
      .replace(/[_\W]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * Normalizes a filename for matching (strips extension, punctuation, extra spaces).
   */
  public static normalizeFilename(filename: string): string {
    const nameWithoutExt = path.parse(filename).name;
    return nameWithoutExt
      .toLowerCase()
      .replace(/[_\W]+/g, " ") // Replace punctuation and underscores with space
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * Computes a similarity score between normalized query and normalized filename.
   * 100: Exact match
   * 98: Compact slug match
   * 85: All query words present or substring
   * 70: Substring
   * 50+: Partial word overlap
   */
  public static scoreMatch(normalizedQuery: string, normalizedFilename: string): number {
    if (!normalizedQuery || !normalizedFilename) return 0;

    // Direct exact match
    if (normalizedQuery === normalizedFilename) return 100;

    // Compact slug match (ignoring spaces entirely)
    const slugQuery = normalizedQuery.replace(/\s+/g, "");
    const slugFile = normalizedFilename.replace(/\s+/g, "");
    if (slugQuery === slugFile) return 98;

    // Substring match
    if (normalizedFilename.includes(normalizedQuery)) return 85;
    if (normalizedQuery.includes(normalizedFilename) && normalizedFilename.length >= 4) return 80;

    // Word token matching
    const queryTokens = normalizedQuery.split(/\s+/).filter((t) => t.length > 1);
    const fileTokens = new Set(normalizedFilename.split(/\s+/).filter((t) => t.length > 1));

    if (queryTokens.length > 0) {
      let matchedCount = 0;
      for (const token of queryTokens) {
        if (fileTokens.has(token) || normalizedFilename.includes(token)) {
          matchedCount++;
        }
      }

      if (matchedCount === queryTokens.length) {
        return 85;
      }
      if (matchedCount > 0) {
        return Math.round((matchedCount / queryTokens.length) * 60);
      }
    }

    return 0;
  }

  /**
   * Performs a bounded, cycle-safe, cancellable asynchronous search across authorized locations.
   */
  public static searchFiles(options: FileSearchOptions): LocalFileSearchResult {
    const startTime = Date.now();
    const normQuery = this.normalizeTitle(options.query);
    const maxDepth = options.maxDepth ?? 4;
    const maxFiles = options.maxFiles ?? 25000;
    const timeoutMs = options.timeoutMs ?? 8000;
    const allowedExts = options.extensions ? new Set(options.extensions.map((e) => e.toLowerCase())) : null;

    // Determine initial locations
    let searchRoots: string[] = [];
    const lowerQuery = (options.query || "").toLowerCase();

    if (options.locations && options.locations.length > 0) {
      searchRoots = options.locations.map((l) => path.resolve(l));
    } else if (this.accessMode === "whole_computer") {
      const libs = this.getUserLibraryDirectories();
      if (lowerQuery.includes("downloads")) {
        searchRoots = [libs.downloads];
      } else if (lowerQuery.includes("music")) {
        searchRoots = [libs.music];
      } else if (lowerQuery.includes("documents")) {
        searchRoots = [libs.documents];
      } else if (lowerQuery.includes("desktop")) {
        searchRoots = [libs.desktop];
      } else if (lowerQuery.includes("videos")) {
        searchRoots = [libs.videos];
      } else {
        searchRoots = [libs.downloads, libs.music, libs.documents, libs.desktop, libs.videos];
        const drives = this.getAccessibleDrives();
        for (const drive of drives) {
          if (!searchRoots.includes(drive) && drive.toUpperCase() !== "C:\\") {
            searchRoots.push(drive);
          }
        }
      }
    } else {
      searchRoots = [...this.approvedDirectories];
    }

    const result: LocalFileSearchResult = {
      query: normQuery,
      found: false,
      candidates: [],
      isAmbiguous: false,
      searchedLocations: searchRoots,
      scannedCount: 0,
      timedOut: false,
      durationMs: 0,
    };

    const visitedDirectories = new Set<string>();
    const seenFiles = new Set<string>();
    const candidates: FileCandidate[] = [];

    const scanDirectory = (currentDir: string, depth: number): boolean => {
      if (depth > maxDepth) return false;
      if (result.scannedCount >= maxFiles) return true;
      if (Date.now() - startTime >= timeoutMs) {
        result.timedOut = true;
        return true;
      }
      if (options.signal?.aborted) {
        return true;
      }

      // Skip sensitive paths
      if (this.isSensitivePath(currentDir).sensitive) {
        return false;
      }

      // Canonical resolve with cycle detection
      let canonicalDir: string;
      try {
        canonicalDir = fs.realpathSync(currentDir);
      } catch {
        // Inaccessible directory (e.g. EPERM / EACCES) - safely ignore without crash
        return false;
      }

      if (visitedDirectories.has(canonicalDir)) {
        return false; // Prevent recursive junction / symlink loops
      }
      visitedDirectories.add(canonicalDir);

      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(canonicalDir, { withFileTypes: true });
      } catch {
        // Access denied or locked folder - gracefully continue
        return false;
      }

      const subDirs: string[] = [];

      for (const entry of entries) {
        if (result.scannedCount >= maxFiles || Date.now() - startTime >= timeoutMs) {
          if (Date.now() - startTime >= timeoutMs) result.timedOut = true;
          return true;
        }

        result.scannedCount++;

        // Exclude hidden/dot files and known system/tooling directories
        if (entry.name.startsWith(".") || this.SENSITIVE_DIR_NAMES.has(entry.name.toLowerCase())) {
          continue;
        }

        const fullPath = path.join(canonicalDir, entry.name);

        if (entry.isDirectory()) {
          subDirs.push(fullPath);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (allowedExts && !allowedExts.has(ext)) {
            continue;
          }

          if (this.isSensitivePath(fullPath).sensitive) {
            continue;
          }

          try {
            const canonicalFile = fs.realpathSync(fullPath);
            if (seenFiles.has(canonicalFile)) {
              continue; // Deduplicate files found through multiple junctions/links
            }
            seenFiles.add(canonicalFile);

            if (this.isSensitivePath(canonicalFile).sensitive) {
              continue;
            }

            const stat = fs.statSync(canonicalFile);
            const normFile = this.normalizeFilename(entry.name);
            const score = this.scoreMatch(normQuery, normFile);

            if (score > 30) {
              candidates.push({
                filename: entry.name,
                canonicalPath: canonicalFile,
                relativePath: path.relative(canonicalDir, canonicalFile),
                extension: ext,
                mimeType: SUPPORTED_AUDIO_EXTENSIONS[ext],
                sizeBytes: stat.size,
                score,
                directory: canonicalDir,
              });

              if (options.stopOnExactMatch && score === 100) {
                // Exact match found!
                return true;
              }
            }
          } catch {
            // Unreadable or locked file - safely skip
          }
        }
      }

      // Recurse into subdirectories
      for (const sub of subDirs) {
        const shouldStop = scanDirectory(sub, depth + 1);
        if (shouldStop) return true;
      }

      return false;
    };

    for (const root of searchRoots) {
      if (!fs.existsSync(root)) continue;
      const shouldStop = scanDirectory(root, 0);
      if (shouldStop && options.stopOnExactMatch && candidates.some((c) => c.score === 100)) {
        break;
      }
    }

    // Sort by score descending, then filename length ascending
    candidates.sort((a, b) => b.score - a.score || a.filename.length - b.filename.length);

    result.candidates = candidates;
    result.durationMs = Date.now() - startTime;

    if (candidates.length === 0) {
      result.found = false;
      return result;
    }

    result.found = true;
    const topScore = candidates[0].score;

    // Detect ambiguity
    const topCandidates = candidates.filter((c) => c.score >= 70);
    if (topCandidates.length > 1 && topScore < 95) {
      result.isAmbiguous = true;
      result.bestMatch = candidates[0];
    } else {
      result.bestMatch = candidates[0];
    }

    return result;
  }

  /**
   * Searches for audio files matching the query within authorized locations.
   * Supports: .mp3, .wav, .m4a, .aac, .ogg, .flac.
   */
  public static searchAudioFiles(
    rawQuery: string,
    directory?: string
  ): LocalAudioSearchResult {
    const locations = directory ? [path.resolve(directory)] : undefined;
    const searchRes = this.searchFiles({
      query: rawQuery,
      extensions: Object.keys(SUPPORTED_AUDIO_EXTENSIONS),
      locations,
      maxDepth: 4,
      maxFiles: 25000,
      timeoutMs: 8000,
      stopOnExactMatch: false,
    });

    const audioCandidates: AudioFileCandidate[] = searchRes.candidates.map((c) => ({
      filename: c.filename,
      canonicalPath: c.canonicalPath,
      relativePath: c.relativePath,
      extension: c.extension,
      mimeType: c.mimeType || SUPPORTED_AUDIO_EXTENSIONS[c.extension] || "audio/mpeg",
      sizeBytes: c.sizeBytes,
      score: c.score,
      directory: c.directory,
    }));

    const result: LocalAudioSearchResult = {
      query: searchRes.query,
      found: searchRes.found,
      candidates: audioCandidates,
      bestMatch: audioCandidates[0],
      isAmbiguous: searchRes.isAmbiguous,
      searchedDirectory: directory ? path.resolve(directory) : this.approvedDirectory,
      searchedLocations: searchRes.searchedLocations,
      scannedCount: searchRes.scannedCount,
      durationMs: searchRes.durationMs,
    };

    return result;
  }

  /**
   * Get supported audio MIME types.
   */
  public static getSupportedAudioExtensions(): Record<string, string> {
    return { ...SUPPORTED_AUDIO_EXTENSIONS };
  }
}
