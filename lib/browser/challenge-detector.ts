import { PageObservation } from "../types/browser";

export type ChallengeBlockType =
  | "GOOGLE_UNUSUAL_TRAFFIC"
  | "CLOUDFLARE_CHALLENGE"
  | "CAPTCHA"
  | "ACCESS_DENIED"
  | "BOT_RESTRICTION"
  | "CONSENT_REQUIRED"
  | "REDIRECT_BLOCKED"
  | "AUTH_REQUIRED"
  | "SUBSCRIPTION_REQUIRED";

export interface ChallengeDetectionResult {
  isBlocked: boolean;
  blockType?: ChallengeBlockType;
  reason?: string;
  url?: string;
  title?: string;
}

/**
 * Autonomous Challenge & Access-Restriction Detector
 * Strictly detects bot challenges (Google /sorry/, Cloudflare, CAPTCHAs, 403 blocks)
 * and prevents unsafe loops or misattributing access blocks as failed searches.
 */
export class ChallengeDetector {
  /**
   * Evaluates a PageObservation (or raw url/title/content) to determine if
   * the browser is currently blocked on an anti-bot or access challenge page.
   */
  static detect(
    observation?: PageObservation | null,
    extraContent?: string
  ): ChallengeDetectionResult {
    if (!observation) {
      return { isBlocked: false };
    }

    const url = (observation.url || "").toLowerCase();
    const title = (observation.title || "").toLowerCase();
    const headings = (observation.headings || []).map((h) => h.toLowerCase());
    const summary = (observation.summary || "").toLowerCase();
    const extra = (extraContent || "").toLowerCase();

    // 1. Google Unusual Traffic / Bot Challenge (/sorry/)
    const isGoogleSorryUrl =
      url.includes("/sorry/") ||
      url.includes("google.com/sorry") ||
      url.includes("/sorry/index");

    const hasUnusualTrafficHeading = headings.some(
      (h) =>
        h.includes("unusual traffic") ||
        h.includes("detected unusual traffic") ||
        (h.includes("about this page") && (isGoogleSorryUrl || title.includes("sorry")))
    );

    const hasUnusualTrafficText =
      summary.includes("unusual traffic") ||
      summary.includes("not a robot") ||
      extra.includes("unusual traffic from your computer network") ||
      extra.includes("not a robot") ||
      title.includes("unusual traffic") ||
      (title === "sorry..." || title.startsWith("sorry"));

    if (isGoogleSorryUrl || (hasUnusualTrafficHeading && (hasUnusualTrafficText || title.includes("sorry")))) {
      return {
        isBlocked: true,
        blockType: "GOOGLE_UNUSUAL_TRAFFIC",
        reason:
          "Access restricted: Target page presented Google unusual-traffic verification (google.com/sorry/). Execution halted safely to prevent repeated blocks.",
        url: observation.url,
        title: observation.title,
      };
    }

    // 2. Google Consent / Privacy Wall
    const isGoogleConsentUrl =
      url.includes("consent.google.") ||
      url.includes("/consent?") ||
      url.includes("consent.youtube.");

    const hasConsentHeading = headings.some(
      (h) =>
        h.includes("before you continue to google") ||
        h.includes("before you continue") ||
        h.includes("choose your privacy settings")
    );

    const hasConsentText =
      summary.includes("before you continue to google") ||
      summary.includes("cookie consent") ||
      extra.includes("before you continue to google") ||
      title.includes("before you continue to google");

    if (isGoogleConsentUrl || (hasConsentHeading && (hasConsentText || title.includes("consent") || isGoogleConsentUrl))) {
      return {
        isBlocked: true,
        blockType: "CONSENT_REQUIRED",
        reason:
          "Access restricted: Target page presented Google consent or privacy choice gate (consent.google.com). Execution halted safely without attempting bypass.",
        url: observation.url,
        title: observation.title,
      };
    }

    // 3. Interstitial Redirect Block / Warning
    const isRedirectBlockedUrl =
      url.includes("google.com/url?") &&
      (headings.some((h) => h.includes("redirect notice") || h.includes("leaving google")) ||
        summary.includes("redirect notice"));

    if (isRedirectBlockedUrl) {
      return {
        isBlocked: true,
        blockType: "REDIRECT_BLOCKED",
        reason:
          "Access restricted: Target page presented an interstitial redirect notice. Execution halted safely.",
        url: observation.url,
        title: observation.title,
      };
    }

    // 2. Cloudflare Challenge / Turnstile / DDoS Protection
    const isCloudflareUrl =
      url.includes("challenges.cloudflare.com") ||
      url.includes("/cdn-cgi/challenge-platform/") ||
      url.includes("cf-challenge");

    const isCloudflareTitle =
      title.includes("just a moment...") ||
      title.includes("attention required!") ||
      (title.includes("cloudflare") && (title.includes("verify") || title.includes("security")));

    const hasCloudflareHeading = headings.some(
      (h) =>
        h.includes("attention required") ||
        h.includes("checking your browser") ||
        h.includes("verify you are human") ||
        h.includes("verify that you are a human")
    );

    const hasCloudflareText =
      summary.includes("checking your browser before accessing") ||
      summary.includes("turnstile") ||
      extra.includes("turnstile") ||
      extra.includes("cf-chl-widget") ||
      extra.includes("checking your browser");

    if (isCloudflareUrl || (isCloudflareTitle && (hasCloudflareHeading || hasCloudflareText))) {
      return {
        isBlocked: true,
        blockType: "CLOUDFLARE_CHALLENGE",
        reason:
          "Access restricted: Target page presented Cloudflare bot protection challenge. Execution halted safely.",
        url: observation.url,
        title: observation.title,
      };
    }

    // 3. Generic CAPTCHA / Bot Verification Challenge
    let urlPath = "";
    let urlHost = "";
    try {
      const parsedUrl = new URL(observation.url);
      urlPath = parsedUrl.pathname.toLowerCase();
      urlHost = parsedUrl.hostname.toLowerCase();
    } catch {
      urlPath = url;
    }

    const hasDedicatedChallengeUrl =
      urlPath.startsWith("/sorry") ||
      urlPath.startsWith("/captcha") ||
      urlPath.includes("/recaptcha/api2/bframe") ||
      urlHost.includes("captcha-delivery") ||
      urlHost.includes("arkoselabs");

    const hasChallengeTitle =
      title.includes("robot or human") ||
      title.includes("verify you are human") ||
      title.includes("human verification") ||
      title.includes("bot verification") ||
      title.includes("security check") ||
      (title.includes("captcha") && !url.includes("search")) ||
      (title.includes("are you human") && !title.includes("song") && !title.includes("podcast")) ||
      title.includes("unusual traffic") ||
      title === "sorry..." ||
      title.startsWith("sorry");

    const hasChallengeHeading = headings.some(
      (h) =>
        h.includes("verify you are human") ||
        h.includes("please verify you are human") ||
        h.includes("security check") ||
        h.includes("unusual traffic") ||
        h.includes("confirm you're not a robot") ||
        h.includes("are you a human") ||
        h.includes("bot detection")
    );

    const hasCaptchaElement = (observation.interactiveElements || []).some((el) => {
      // Must be visible. Never classify hidden background telemetry/tokens (e.g. g-recaptcha-response) as active challenges.
      if (!el.isVisible || el.type === "hidden") return false;

      const name = (el.name || "").toLowerCase();
      const id = (el.id || "").toLowerCase();
      const text = (el.text || "").toLowerCase();
      const label = (el.label || "").toLowerCase();
      const aria = (el.ariaLabel || "").toLowerCase();

      // Specifically ignore hidden/passive tokens
      if (name.includes("g-recaptcha-response") || id.includes("g-recaptcha-response")) {
        return false;
      }

      // Explicit human-verification prompts
      const hasHumanVerificationText =
        text.includes("i'm not a robot") ||
        label.includes("i'm not a robot") ||
        aria.includes("i'm not a robot") ||
        text.includes("verify you are human") ||
        label.includes("verify you are human") ||
        aria.includes("verify you are human") ||
        text.includes("press & hold") ||
        text.includes("slide to verify") ||
        text.includes("complete the security check");

      if (hasHumanVerificationText) return true;

      // Active interactive verification checkboxes or turnstile widgets on challenge pages
      const isChallengeWidget =
        id.includes("recaptcha-anchor") ||
        id.includes("cf-turnstile") ||
        (name.includes("recaptcha") && el.tagName === "INPUT" && el.type === "checkbox");

      if (isChallengeWidget && (hasChallengeTitle || hasChallengeHeading || hasDedicatedChallengeUrl)) {
        return true;
      }

      return false;
    });

    const hasCaptchaForm = (observation.forms || []).some(
      (f) =>
        ((f.action || "").toLowerCase().includes("sorry") ||
          (f.action || "").toLowerCase().includes("captcha") ||
          (f.id || "").toLowerCase().includes("captcha")) &&
        (hasChallengeTitle || hasChallengeHeading || hasCaptchaElement || hasDedicatedChallengeUrl)
    );

    // Conclusive CAPTCHA challenge requirement:
    // Requires either an active visible human-verification element, or a dedicated challenge URL/form with challenge heading/title.
    // Ordinary login screens, cookie banners, or pages with passive background scripts must NOT be classified as blocked.
    const isGenuineCaptchaChallenge =
      hasCaptchaElement ||
      (hasDedicatedChallengeUrl && (hasChallengeTitle || hasChallengeHeading || hasCaptchaForm)) ||
      (hasCaptchaForm && (hasChallengeTitle || hasChallengeHeading));

    if (isGenuineCaptchaChallenge) {
      return {
        isBlocked: true,
        blockType: "CAPTCHA",
        reason:
          "Access restricted: Target page requires manual CAPTCHA verification. Execution halted safely without attempting automated bypass.",
        url: observation.url,
        title: observation.title,
      };
    }

    // 4. Access Denied / 403 Forbidden / WAF Blocks
    const isAccessDenied =
      title.includes("access denied") ||
      title.includes("403 forbidden") ||
      headings.some(
        (h) =>
          h.includes("access denied") ||
          h.includes("error 1020") ||
          h.includes("403 forbidden") ||
          h.includes("request blocked")
      );

    if (isAccessDenied) {
      return {
        isBlocked: true,
        blockType: "ACCESS_DENIED",
        reason:
          "Access restricted: Target page responded with Access Denied or WAF block. Execution halted safely.",
        url: observation.url,
        title: observation.title,
      };
    }

    // 5. Authentication & Subscription Restrictions for Media / Playback
    const allTexts: string[] = [
      title,
      summary,
      extra,
      ...headings,
      ...(observation.dialogs || []).map((d) => d.message?.toLowerCase() || ""),
      ...(observation.interactiveElements || [])
        .filter((el) => el.isVisible && (el.text || el.label || el.ariaLabel))
        .map((el) => `${el.text || ""} ${el.label || ""} ${el.ariaLabel || ""}`.toLowerCase()),
    ];

    const AUTH_PATTERNS = [
      /\b(?:sign(?:ing)?\s*in|log(?:ging)?\s*in|login)\s+(?:is\s+)?(?:required|needed)\b/i,
      /\b(?:sign(?:ing)?\s*in|log(?:ging)?\s*in|login)\s+(?:is\s+)?(?:required|needed)?\s*to\s+(?:listen|play|watch|stream|hear|continue|enjoy|unlock|access|full\s+(?:track|song|video|album|content))\b/i,
      /\b(?:sign(?:ing)?\s*in|log(?:ging)?\s*in|login)\b[^\n.!?]*\bto\b[^\n.!?]*\b(?:listen|play|watch|stream|hear|continue|enjoy|unlock|access|full\s+(?:track|song|video|album|content))\b/i,
      /\b(?:sign(?:ing)?\s*in|log(?:ging)?\s*in|login)\s+to\s+see\s+lyrics\s+and\s+listen\s+to\s+(?:the\s+)?full\s+(?:track|song)\b/i,
      /\bto\s+(?:see\s+lyrics\s+and\s+)?(?:listen|play|watch|stream|hear|enjoy)\b[^\n.!?]*\b(?:sign\s*in|log\s*in|login)\b/i,
      /\bneed\s+to\s+(?:sign\s*in|log\s*in|login)\s+(?:to\s+)?(?:listen|play|watch|stream)\b/i,
      /\bcreate\s+(?:a\s+)?(?:free\s+)?account\s+or\s+(?:sign\s*in|log\s*in)\s+to\s+(?:listen|play|watch|stream)\b/i,
      /\b(?:please\s+)?(?:sign\s*in|log\s*in)\s+(?:with\s+your\s+account\s+)?to\s+(?:listen|play|watch|stream|see\s+lyrics)\b/i,
      /\bsign\s*in\s+to\s+confirm\s+you(?:'re|\s+are)\s+not\s+a\s+bot\b/i,
      /\bsign\s*in\s+to\s+confirm\s+your\s+age\b/i,
    ];

    const SUB_PATTERNS = [
      /\bsubscription\s+(?:is\s+)?(?:required|needed)\s+to\s+(?:listen|play|watch|stream)\b/i,
      /\bupgrade\s+to\s+premium\s+to\s+(?:listen|play|watch|stream)\b/i,
      /\bpremium\s+(?:is\s+)?(?:required|needed)\s+to\s+(?:listen|play|watch|stream)\b/i,
      /\b(?:get|upgrade\s+to)\s+premium\s+to\s+(?:listen|play|watch|stream)\s+(?:to\s+)?the\s+full\s+(?:track|song|video|album)\b/i,
      /\b(?:members?|subscribers?)\s+only\b/i,
      /\bavailable\s+only\s+(?:with|to)\s+(?:premium|subscribers?)\b/i,
    ];

    for (const text of allTexts) {
      for (const p of AUTH_PATTERNS) {
        const match = text.match(p);
        if (match) {
          return {
            isBlocked: true,
            blockType: "AUTH_REQUIRED",
            reason: `Access restricted: Target page requires manual sign-in to access or play media ("${match[0].trim()}"). Execution halted safely without attempting automated bypass. Please sign in manually in the visible browser window to continue.`,
            url: observation.url,
            title: observation.title,
          };
        }
      }
      for (const p of SUB_PATTERNS) {
        const match = text.match(p);
        if (match) {
          return {
            isBlocked: true,
            blockType: "SUBSCRIPTION_REQUIRED",
            reason: `Access restricted: Target page requires a paid subscription to play media ("${match[0].trim()}"). Execution halted safely without attempting automated bypass.`,
            url: observation.url,
            title: observation.title,
          };
        }
      }
    }

    return { isBlocked: false };
  }
}
