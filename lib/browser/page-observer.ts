import { Page } from "playwright";
import { ObservedElement, PageObservation } from "../types/browser";
import { LocatorStrategy, ElementTarget } from "../types/actions";

/**
 * Token-efficient Page Observer (Section 7)
 * Extracts a normalized, structured DOM snapshot without flooding LLM context.
 */
export class PageObserver {
  /**
   * Captures a normalized snapshot of the active browser page.
   */
  static async observe(
    page: Page,
    tabId = "tab-1",
    options?: { focusTarget?: string; maxElements?: number }
  ): Promise<PageObservation> {
    if (!page || (typeof page.isClosed === "function" && page.isClosed())) {
      return {
        url: "",
        title: "Page Closed",
        headings: [],
        interactiveElements: [],
        forms: [],
        dialogs: [],
        summary: "Browser page is closed or unavailable",
        timestamp: new Date().toISOString(),
        tabId,
        pageType: "error",
        isSettled: false,
      };
    }

    try {
      const url = page.url();
      const title = await page.title().catch(() => "");

      // Execute browser-side extraction script with single bounded retry if navigation was in flight
      let rawObservation: {
        interactiveElements: any[];
        headings: string[];
        forms: any[];
        mediaElements: any[];
        dialogs: any[];
      };

      try {
        const evalTarget = options?.focusTarget?.toLowerCase();
        const evalMax = options?.maxElements || 80;
        rawObservation = await page.evaluate(
          ({ targetQuery, maxCount }) => {
            const interactiveElements: Array<{
            id: string;
            role?: string;
            tagName: string;
            type?: string;
            name?: string;
            text?: string;
            label?: string;
            placeholder?: string;
            value?: string;
            href?: string;
            testId?: string;
            ariaLabel?: string;
            titleAttr?: string;
            isVisible: boolean;
            isEnabled: boolean;
            isChecked?: boolean;
            isSelected?: boolean;
          }> = [];

          // Select interactive candidates and status/confirmation elements
          const nodes = document.querySelectorAll(
            'button, a, input, select, textarea, [role="button"], [role="link"], [role="textbox"], [role="checkbox"], [tabindex="0"], [role="status"], [role="alert"], [id*="confirmation"], [id*="success"], [id*="message"], [data-testid*="success"], [data-testid*="confirm"]'
          );

          let count = 0;
          const limit = typeof maxCount === "number" ? maxCount : 80;
          nodes.forEach((node) => {
            const el = node as HTMLElement;
            const elText = (el.innerText || el.textContent || "").toLowerCase();
            const elAria = (el.getAttribute("aria-label") || "").toLowerCase();
            const elPlace = (el.getAttribute("placeholder") || "").toLowerCase();
            const idOrName = `${el.id || ""} ${el.getAttribute("name") || ""} ${el.getAttribute("data-testid") || ""}`.toLowerCase();
            const isMatch = Boolean(
              targetQuery &&
              (elText.includes(targetQuery) ||
                elAria.includes(targetQuery) ||
                elPlace.includes(targetQuery) ||
                idOrName.includes(targetQuery))
            );

            if (count >= limit && !isMatch) return;
            if (count >= limit + 25) return;
            const rect = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            const isVisible =
              rect.width > 0 &&
              rect.height > 0 &&
              style.visibility !== "hidden" &&
              style.display !== "none" &&
              style.opacity !== "0";

            // Associated label detection
            let labelText: string | undefined;
            if (el.id) {
              const labelEl = document.querySelector(`label[for="${el.id}"]`);
              if (labelEl) labelText = labelEl.textContent?.trim();
            }
            if (!labelText && el.closest("label")) {
              labelText = el.closest("label")?.textContent?.trim();
            }

            const role = el.getAttribute("role") || (el.tagName === "BUTTON" ? "button" : el.tagName === "A" ? "link" : undefined);
            const type = (el as HTMLInputElement).type;
            const name = el.getAttribute("name") || undefined;
            const text = (el.innerText || el.textContent || "").trim().slice(0, 100);
            const placeholder = el.getAttribute("placeholder") || undefined;
            const value = (el as HTMLInputElement).value;
            const href = (el as HTMLAnchorElement).href;
            const testId = el.getAttribute("data-testid") || undefined;
            const ariaLabel = el.getAttribute("aria-label") || undefined;
            const titleAttr = el.getAttribute("title") || undefined;
            const isEnabled = !(el as HTMLButtonElement).disabled;
            const isChecked = (el as HTMLInputElement).checked;

            // Unique reference id
            const id = el.id || el.getAttribute("data-testid") || el.getAttribute("name") || `elem-${++count}`;

            interactiveElements.push({
              id,
              role,
              tagName: el.tagName,
              type,
              name,
              text: text || undefined,
              label: labelText,
              placeholder,
              value: value || undefined,
              href: href || undefined,
              testId,
              ariaLabel,
              titleAttr,
              isVisible,
              isEnabled,
              isChecked,
            });
          });

          // Inspect media elements (video and audio)
          const mediaElements: Array<{
            id?: string;
            tagName: "video" | "audio";
            src?: string;
            currentSrc?: string;
            isPlaying: boolean;
            isPaused: boolean;
            isMuted: boolean;
            currentTime: number;
            duration: number;
            volume: number;
            readyState: number;
            ended: boolean;
            error?: string | null;
          }> = [];

          document.querySelectorAll("video, audio").forEach((m) => {
            const media = m as HTMLMediaElement;
            mediaElements.push({
              id: media.id || media.getAttribute("data-testid") || undefined,
              tagName: media.tagName.toLowerCase() as "video" | "audio",
              src: media.src || undefined,
              currentSrc: media.currentSrc || undefined,
              isPlaying: !media.paused && !media.ended && media.currentTime > 0,
              isPaused: media.paused,
              isMuted: media.muted,
              currentTime: Number(media.currentTime.toFixed(2)),
              duration: isNaN(media.duration) ? 0 : Number(media.duration.toFixed(2)),
              volume: Number(media.volume.toFixed(2)),
              readyState: media.readyState,
              ended: media.ended,
              error: media.error ? media.error.message || `MediaError_${media.error.code}` : null,
            });
          });

          // If no HTML <audio>/<video> tags exist (or only muted/decorative background videos exist), inspect modern web audio / streaming UI player states
          const hasUnmutedHtmlMedia = mediaElements.some((m) => !m.isMuted && (m.isPlaying || m.readyState >= 2));
          if (mediaElements.length === 0 || !hasUnmutedHtmlMedia) {
            const pauseControl = Array.from(
              document.querySelectorAll<HTMLElement>(
                "button[aria-label*='Pause' i], [role='button'][aria-label*='Pause' i], button[title*='Pause' i], [data-testid*='playpause'][aria-label*='Pause' i]"
              )
            ).find((el) => {
              const rect = el.getBoundingClientRect();
              const style = window.getComputedStyle(el);
              const isEnabled = !el.hasAttribute("disabled") && !(el as HTMLButtonElement).disabled && el.getAttribute("aria-disabled") !== "true";
              return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && isEnabled;
            });

            const playControl = Array.from(
              document.querySelectorAll<HTMLElement>(
                "button[data-testid='play-button'], button[data-testid='action-bar-row-play-button'], button[aria-label*='Play' i], [role='button'][aria-label*='Play' i], button[title*='Play' i], [data-testid*='playpause'][aria-label*='Play' i]"
              )
            ).find((el) => {
              const rect = el.getBoundingClientRect();
              const style = window.getComputedStyle(el);
              return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
            });

            // Also check if any disabled playpause button exists (indicating blocked playback)
            const disabledPauseControl = Array.from(
              document.querySelectorAll<HTMLElement>(
                "button[aria-label*='Pause' i], [data-testid*='playpause'][aria-label*='Pause' i]"
              )
            ).find((el) => {
              return el.hasAttribute("disabled") || (el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true";
            });

            if (pauseControl && !disabledPauseControl) {
              // Visible, ENABLED Pause control confirms media playback is active on streaming interface
              if (mediaElements.length > 0 && !hasUnmutedHtmlMedia) {
                // Remove decorative background canvas videos from dominating audio player state
                mediaElements.length = 0;
              }
              mediaElements.push({
                id: pauseControl.id || pauseControl.getAttribute("data-testid") || "ui-player",
                tagName: "audio",
                src: "web-audio-stream",
                currentSrc: "web-audio-stream",
                isPlaying: true,
                isPaused: false,
                isMuted: false,
                currentTime: 1,
                duration: 0,
                volume: 1,
                readyState: 4,
                ended: false,
                error: null,
              });
            } else if (playControl || disabledPauseControl) {
              // Visible Play control or disabled pause control indicates player is present but paused / not playing
              if (mediaElements.length > 0 && !hasUnmutedHtmlMedia) {
                mediaElements.length = 0;
              }
              mediaElements.push({
                id: (playControl || disabledPauseControl)?.id || (playControl || disabledPauseControl)?.getAttribute("data-testid") || "ui-player",
                tagName: "audio",
                src: "web-audio-stream",
                currentSrc: "web-audio-stream",
                isPlaying: false,
                isPaused: true,
                isMuted: false,
                currentTime: 0,
                duration: 0,
                volume: 1,
                readyState: 2,
                ended: false,
                error: null,
              });
            }
          }

          // Collect top headings, prominent status / confirmation banners, zero-results notices, and auth prompts
          const headings: string[] = [];
          document
            .querySelectorAll(
              "h1, h2, h3, [role='status'], [role='alert'], [role='banner'], [data-testid*='banner'], [class*='banner'], [id*='banner'], [class*='auth'], [class*='prompt'], [class*='upsell'], [data-testid*='prompt'], [data-testid*='banner'], [data-testid*='lyrics'], [class*='lyrics'], [id*='success'], [id*='confirm'], [class*='text-center'], [class*='empty'], [class*='no-results']"
            )
            .forEach((h) => {
              const t = (h.textContent || "").trim();
              if (t && headings.length < 16 && !headings.includes(t) && t.length < 250) headings.push(t);
            });

          // Also capture modal dialogs, alert dialogs, and auth prompts
          const dialogs: Array<{ type: "alert" | "confirm" | "prompt" | "modal"; message: string }> = [];
          document.querySelectorAll("[role='dialog'], [role='alertdialog'], dialog, .modal, [class*='modal']").forEach((d) => {
            const msg = (d.textContent || "").trim();
            if (msg && dialogs.length < 5) {
              dialogs.push({ type: "modal", message: msg.slice(0, 300) });
            }
          });

          // Also capture specific zero-results notices from paragraphs/divs if not yet captured
          if (document.body) {
            const emptyNotice = Array.from(document.querySelectorAll("div, p, span")).find((el) => {
              const txt = el.textContent?.trim() || "";
              return (
                txt.length > 5 &&
                txt.length < 150 &&
                /no (?:products|results)|0 (?:products|results)|not match any|did not match/i.test(txt) &&
                el.children.length === 0
              );
            });
            if (emptyNotice) {
              const t = emptyNotice.textContent?.trim() || "";
              if (t && !headings.includes(t)) headings.push(t);
            }
          }

          // If no headings found, capture any prominent challenge warning line
          if (headings.length === 0 && document.body) {
            const bodySnippet = document.body.innerText.slice(0, 600);
            if (
              bodySnippet.toLowerCase().includes("unusual traffic") ||
              bodySnippet.toLowerCase().includes("attention required") ||
              bodySnippet.toLowerCase().includes("not a robot")
            ) {
              const lines = bodySnippet.split("\n").map((l) => l.trim()).filter((l) => l.length > 5);
              if (lines[0]) headings.push(lines[0].slice(0, 100));
            }
          }

          // Collect forms and available options
          const forms: Array<{
            id?: string;
            action?: string;
            inputs: string[];
            options?: Array<{ name?: string; value: string; text: string }>;
          }> = [];
          document.querySelectorAll("form").forEach((f) => {
            const inputs: string[] = [];
            const options: Array<{ name?: string; value: string; text: string }> = [];
            f.querySelectorAll("input, textarea, select").forEach((inp) => {
              const n = inp.getAttribute("name") || inp.getAttribute("id");
              if (n) inputs.push(n);
              if (inp.tagName === "SELECT") {
                Array.from((inp as HTMLSelectElement).options).forEach((opt) => {
                  options.push({ name: n || undefined, value: opt.value, text: opt.text });
                });
              }
            });
            forms.push({
              id: f.id || undefined,
              action: f.getAttribute("action") || undefined,
              inputs,
              options: options.length > 0 ? options : undefined,
            });
          });

          return { interactiveElements, headings, forms, mediaElements, dialogs };
        }, { targetQuery: evalTarget, maxCount: evalMax });
      } catch (evalErr) {
        // If navigation was in progress or execution context destroyed, wait briefly and retry once
        await page.waitForLoadState("domcontentloaded", { timeout: 2000 }).catch(() => {});
        rawObservation = await page.evaluate(() => {
          const headings: string[] = [];
          document.querySelectorAll("h1, h2, h3").forEach((h) => {
            const t = (h.textContent || "").trim();
            if (t && headings.length < 8) headings.push(t);
          });
          return { interactiveElements: [], headings, forms: [], mediaElements: [], dialogs: [] };
        });
      }

      if (!rawObservation || !Array.isArray(rawObservation.interactiveElements)) {
        rawObservation = {
          interactiveElements: [],
          headings: (rawObservation as any)?.headings || [],
          forms: (rawObservation as any)?.forms || [],
          mediaElements: (rawObservation as any)?.mediaElements || [],
          dialogs: (rawObservation as any)?.dialogs || [],
        };
      }

      // Enrich elements with candidate locator strategies
      const enrichedElements: ObservedElement[] = rawObservation.interactiveElements.map((el) => {
        const locatorCandidates: ObservedElement["locatorCandidates"] = [];

        if (el.role && (el.text || el.name)) {
          locatorCandidates.push({
            strategy: LocatorStrategy.ROLE,
            value: el.text || el.name!,
            confidence: 0.95,
          });
        }
        if (el.label) {
          locatorCandidates.push({
            strategy: LocatorStrategy.LABEL,
            value: el.label,
            confidence: 0.9,
          });
        }
        if (el.placeholder) {
          locatorCandidates.push({
            strategy: LocatorStrategy.PLACEHOLDER,
            value: el.placeholder,
            confidence: 0.85,
          });
        }
        if (el.ariaLabel || el.titleAttr) {
          locatorCandidates.push({
            strategy: LocatorStrategy.ACCESSIBLE_ATTR,
            value: el.ariaLabel || el.titleAttr!,
            confidence: 0.88,
          });
        }
        if (el.testId) {
          locatorCandidates.push({
            strategy: LocatorStrategy.TEST_ID,
            value: el.testId,
            confidence: 0.85,
          });
        }
        if (el.name) {
          locatorCandidates.push({
            strategy: LocatorStrategy.NAME,
            value: el.name,
            confidence: 0.8,
          });
        }
        if (el.text && el.text.length < 50) {
          locatorCandidates.push({
            strategy: LocatorStrategy.TEXT,
            value: el.text,
            confidence: 0.75,
          });
        }

        return {
          ...el,
          locatorCandidates,
        };
      });

      // Build token-efficient summary string
      const visibleCount = enrichedElements.filter((e) => e.isVisible).length;
      const buttonCount = enrichedElements.filter((e) => e.role === "button" || e.tagName === "BUTTON").length;
      const inputCount = enrichedElements.filter((e) => e.tagName === "INPUT" || e.tagName === "TEXTAREA").length;
      const linkCount = enrichedElements.filter((e) => e.role === "link" || e.tagName === "A").length;
      const mediaCount = (rawObservation.mediaElements || []).length;

      const summary = `PAGE: "${title}" (URL: ${url}). Headings: [${rawObservation.headings.join(", ")}]. Elements: ${visibleCount} visible (${buttonCount} buttons, ${inputCount} inputs, ${linkCount} links, ${mediaCount} media).`;

      // Classify page type
      let pageType: PageObservation["pageType"] = "normal";
      const urlLower = url.toLowerCase();
      if (urlLower.includes("/sorry") || urlLower.includes("cloudflare") || urlLower.includes("captcha")) {
        pageType = "challenge";
      } else if (urlLower.includes("consent.google") || urlLower.includes("/consent")) {
        pageType = "consent";
      } else if (visibleCount === 0 && rawObservation.headings.length === 0) {
        pageType = "empty";
      } else if (urlLower.includes("search") || rawObservation.headings.some((h) => /search|results|products/i.test(h))) {
        pageType = "search_results";
      }

      return {
        url,
        title,
        headings: rawObservation.headings,
        interactiveElements: enrichedElements,
        mediaElements: rawObservation.mediaElements || [],
        forms: rawObservation.forms,
        dialogs: rawObservation.dialogs || [],
        summary,
        timestamp: new Date().toISOString(),
        tabId,
        pageType,
        isSettled: true,
      };
    } catch (err) {
      let pageUrl = "";
      try {
        pageUrl = page.url();
      } catch {
        pageUrl = "unknown";
      }
      return {
        url: pageUrl,
        title: "",
        headings: [],
        interactiveElements: [],
        forms: [],
        dialogs: [],
        summary: `Observation failed: ${err instanceof Error ? err.message : "Unknown error"}`,
        timestamp: new Date().toISOString(),
        tabId,
        pageType: "error",
        isSettled: false,
      };
    }
  }

  /**
   * Progressive DOM Inspection (Section 3 & Vector dom_inspector.py)
   * When a target is not found within the initial compact observation sample,
   * performs a targeted live query on the page to verify whether the element actually exists
   * without treating a sample limit as proof of absence.
   */
  static async progressiveInspect(
    page: Page,
    target: ElementTarget | string,
    tabId = "tab-1"
  ): Promise<{ found: boolean; element?: ObservedElement; observation: PageObservation }> {
    const targetQuery = typeof target === "string" ? target : target.value || target.name || "";
    if (!targetQuery) {
      const obs = await this.observe(page, tabId);
      return { found: false, observation: obs };
    }

    // 1. Re-observe with targeted focus and expanded element quota
    const obs = await this.observe(page, tabId, { focusTarget: targetQuery, maxElements: 120 });

    // 2. Search enriched interactive elements
    const q = targetQuery.toLowerCase().trim();
    const match = obs.interactiveElements.find((el) => {
      return (
        (el.text && el.text.toLowerCase().includes(q)) ||
        (el.label && el.label.toLowerCase().includes(q)) ||
        (el.name && el.name.toLowerCase().includes(q)) ||
        (el.placeholder && el.placeholder.toLowerCase().includes(q)) ||
        (el.ariaLabel && el.ariaLabel.toLowerCase().includes(q)) ||
        (el.id && el.id.toLowerCase().includes(q)) ||
        (el.testId && el.testId.toLowerCase().includes(q))
      );
    });

    if (match) {
      return { found: true, element: match, observation: obs };
    }

    // 3. Progressive live DOM fallback query across the entire document
    try {
      const liveCandidate = await page.evaluate((query) => {
        const queryLower = query.toLowerCase();
        const allInteractive = Array.from(
          document.querySelectorAll("button, a, input, select, textarea, [role], [tabindex], [onclick]")
        );
        const found = allInteractive.find((el) => {
          const text = (el.textContent || "").toLowerCase();
          const label = el.getAttribute("aria-label")?.toLowerCase() || "";
          const placeholder = (el as HTMLInputElement).placeholder?.toLowerCase() || "";
          const name = el.getAttribute("name")?.toLowerCase() || "";
          const id = el.id?.toLowerCase() || "";
          const testId = el.getAttribute("data-testid")?.toLowerCase() || "";
          return (
            text.includes(queryLower) ||
            label.includes(queryLower) ||
            placeholder.includes(queryLower) ||
            name.includes(queryLower) ||
            id.includes(queryLower) ||
            testId.includes(queryLower)
          );
        }) as HTMLElement | undefined;

        if (!found) return null;
        const rect = found.getBoundingClientRect();
        const style = window.getComputedStyle(found);
        const isVisible =
          rect.width > 0 &&
          rect.height > 0 &&
          style.visibility !== "hidden" &&
          style.display !== "none" &&
          style.opacity !== "0";

        return {
          id: found.id || found.getAttribute("data-testid") || `progressive-${Date.now()}`,
          role: found.getAttribute("role") || (found.tagName === "BUTTON" ? "button" : found.tagName === "A" ? "link" : undefined),
          tagName: found.tagName,
          type: (found as HTMLInputElement).type || undefined,
          name: found.getAttribute("name") || undefined,
          text: (found.innerText || found.textContent || "").trim().slice(0, 100) || undefined,
          label: found.getAttribute("aria-label") || undefined,
          placeholder: (found as HTMLInputElement).placeholder || undefined,
          value: (found as HTMLInputElement).value || undefined,
          href: (found as HTMLAnchorElement).href || undefined,
          testId: found.getAttribute("data-testid") || undefined,
          ariaLabel: found.getAttribute("aria-label") || undefined,
          isVisible,
          isEnabled: !(found as HTMLButtonElement).disabled,
        };
      }, targetQuery);

      if (liveCandidate) {
        const enriched: ObservedElement = {
          ...liveCandidate,
          locatorCandidates: [
            {
              strategy: LocatorStrategy.ROLE,
              value: liveCandidate.text || liveCandidate.name || liveCandidate.id,
              confidence: 0.95,
            },
            {
              strategy: LocatorStrategy.TEXT,
              value: liveCandidate.text || targetQuery,
              confidence: 0.8,
            },
            {
              strategy: LocatorStrategy.ID,
              value: liveCandidate.id,
              confidence: 0.85,
            },
          ],
        };
        obs.interactiveElements.push(enriched);
        return { found: true, element: enriched, observation: obs };
      }
    } catch {
      // DOM evaluation fallback
    }

    return { found: false, observation: obs };
  }
}

