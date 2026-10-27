import { Page, Locator } from "playwright";
import { Action, ActionExecutionResult, ActionStatus, ActionType } from "../types/actions";
import { PageObservation } from "../types/browser";
import { ErrorCode, AgentError } from "../types/errors";
import { PreExecutionValidator } from "../validation/pre-execution-validator";
import { ActionVerifier } from "../agent/action-verifier";
import { PageObserver } from "./page-observer";
import { browserManager } from "./browser-manager";
import { validateUrlString } from "../validation/url-policy";
import { LocalFileResolver } from "../local/local-file-resolver";
import { SearchResultResolver } from "./search-result-resolver";

export class ActionExecutor {
  /**
   * Deterministically executes an individual action with pre-validation and post-verification.
   */
  static async execute(params: {
    action: Action;
    page: Page;
    tabId: string;
    beforeObservation?: PageObservation | null;
    lastResolvedLocator?: Locator;
    authorizedTask?: string;
    initialTargetUrl?: string;
    taskId?: string;
    stepIndex?: number;
  }): Promise<{
    result: ActionExecutionResult;
    afterObservation: PageObservation;
    resolvedLocator?: Locator;
  }> {
    const { action, page, tabId, beforeObservation, lastResolvedLocator, authorizedTask, initialTargetUrl, taskId, stepIndex } = params;
    const startTime = new Date().toISOString();
    const startMs = Date.now();

    // 1. Observe state before action if not already provided
    const currentObs = beforeObservation || (await PageObserver.observe(page, tabId));

    try {
      // 2. Pre-Execution Validation Guardrail (Part 8 & Phase 3 Security)
      const validation = await PreExecutionValidator.validate({
        action,
        page,
        currentObservation: currentObs,
        lastResolvedLocator,
        authorizedTask,
        initialTargetUrl,
      });

      if (validation.requiresUserConfirmation) {
        throw new AgentError(validation.reason, ErrorCode.VALIDATION_FAILED, false, { action });
      }

      let extractedData: unknown = undefined;
      let downloadPath: string | undefined = undefined;

      // 3. Execution (Skip if already satisfied)
      if (validation.skipAction) {
        return {
          result: {
            actionId: action.id,
            taskId,
            stepIndex,
            userIntent: action.userIntent || action.reason,
            type: action.type,
            status: ActionStatus.COMPLETED,
            currentUrl: currentObs.url,
            targetDescription: action.targetDescription || action.target?.value,
            validationResult: {
              valid: true,
              reason: validation.reason,
              skipAction: true,
              strategyUsed: validation.strategyUsed,
              isSafeToRetry: validation.isSafeToRetry,
            },
            startTime,
            endTime: new Date().toISOString(),
            durationMs: Date.now() - startMs,
            retriesUsed: 0,
            resultingState: {
              url: currentObs.url,
              title: currentObs.title,
              isSettled: currentObs.isSettled,
            },
            verified: true,
          },
          afterObservation: currentObs,
          resolvedLocator: validation.resolvedLocator,
        };
      }

      const locator = validation.resolvedLocator;

      switch (action.type) {
        case ActionType.NAVIGATE: {
          const targetUrl = String(action.value || "");
          validateUrlString(targetUrl, "action execution navigation");
          const currentUrl = page.url();
          if (currentUrl === targetUrl || currentUrl.replace(/\/$/, "") === targetUrl.replace(/\/$/, "")) {
            extractedData = { finalUrl: currentUrl, status: 200 };
            break;
          }
          const response = await page.goto(targetUrl, {
            waitUntil: "domcontentloaded",
            timeout: action.timeout || 30000,
          });
          if (response) {
            const finalUrl = response.url();
            validateUrlString(finalUrl, "navigation redirect destination");
            const status = response.status();
            if (status === 404) {
              throw new AgentError(
                `Page at ${finalUrl} returned HTTP 404 (Not Found)`,
                ErrorCode.NAVIGATION_FAILED,
                false
              );
            }
            if (status >= 500) {
              throw new AgentError(
                `Page at ${finalUrl} returned HTTP ${status} (Server Error)`,
                ErrorCode.NETWORK_ERROR,
                true
              );
            }
            extractedData = { finalUrl, status };
          } else {
            // Client-side navigation or in-page hash change
            const finalUrl = page.url();
            validateUrlString(finalUrl, "client-side navigation destination");
            extractedData = { finalUrl, status: 200 };
          }
          break;
        }

        case ActionType.BACK: {
          const resp = await page.goBack({ timeout: action.timeout || 30000, waitUntil: "domcontentloaded" }).catch(() => null);
          extractedData = { finalUrl: page.url(), status: resp ? resp.status() : 200 };
          break;
        }

        case ActionType.FORWARD: {
          const resp = await page.goForward({ timeout: action.timeout || 30000, waitUntil: "domcontentloaded" }).catch(() => null);
          extractedData = { finalUrl: page.url(), status: resp ? resp.status() : 200 };
          break;
        }

        case ActionType.RELOAD: {
          const resp = await page.reload({ timeout: action.timeout || 30000, waitUntil: "domcontentloaded" }).catch(() => null);
          extractedData = { finalUrl: page.url(), status: resp ? resp.status() : 200 };
          break;
        }

        case ActionType.CLICK: {
          const isSearchResultClick =
            action.id?.includes("click-result") ||
            action.id?.includes("open-result") ||
            (action.reason && /matching\s+(?:media|product|content|search|article)?\s*result/i.test(action.reason)) ||
            (action.target as any)?.isSearchResult === true;

          if (isSearchResultClick) {
            let targetTerm = (action.value ? String(action.value) : "").trim();
            if (!targetTerm && action.target?.value) {
              const hasTextMatch = action.target.value.match(/:has-text\(\s*["']([^"']+)["']\s*\)/i);
              if (hasTextMatch) {
                targetTerm = hasTextMatch[1].trim();
              }
            }
            if (!targetTerm && action.reason) {
              const forMatch = action.reason.match(/for\s+['"]([^'"]+)['"]/i);
              if (forMatch) targetTerm = forMatch[1].trim();
            }

            const resolution = await SearchResultResolver.resolveSearchResult(page, {
              query: targetTerm,
              instruction: action.userIntent || action.reason,
              ordinalIndex: action.target?.index,
              timeoutMs: action.timeout || 6000,
            });

            if (resolution.status === "resolved" && resolution.selectedCandidate) {
              const targetLocator = await SearchResultResolver.revalidateAndLocate(page, resolution.selectedCandidate);
              await targetLocator.click({ timeout: action.timeout || 10000 });
              await page.waitForLoadState("domcontentloaded").catch(() => {});

              extractedData = {
                searchResolution: {
                  query: targetTerm,
                  selectedTitle: resolution.selectedCandidate.title,
                  selectedUrl: resolution.selectedCandidate.url,
                  score: resolution.selectedCandidate.score,
                  distinctResultsCount: resolution.distinctResultsCount,
                  deduplicatedCount: resolution.deduplicatedCount,
                  selectionRationale: resolution.diagnostics.selectionRationale,
                },
              };
            } else if (resolution.status === "ambiguous") {
              throw new AgentError(
                resolution.ambiguityReason || `Multiple ambiguous search results found for '${targetTerm}'. User clarification required.`,
                ErrorCode.ELEMENT_AMBIGUOUS,
                true,
                {
                  query: targetTerm,
                  options: resolution.clarificationOptions,
                  diagnostics: resolution.diagnostics,
                }
              );
            } else {
              // No matching candidate from resolver: fail honestly with recoverable ELEMENT_NOT_FOUND
              throw new AgentError(
                resolution.diagnostics.selectionRationale || `No matching search result found for '${targetTerm}'.`,
                ErrorCode.ELEMENT_NOT_FOUND,
                true,
                { targetTerm, diagnostics: resolution.diagnostics }
              );
            }
          } else {
            await locator!.click({ timeout: action.timeout || 10000 });
          }
          break;
        }

        case ActionType.DOUBLE_CLICK: {
          await locator!.dblclick({ timeout: action.timeout || 10000 });
          break;
        }

        case ActionType.FILL: {
          await locator!.fill(String(action.value ?? ""), { timeout: action.timeout || 10000 });
          break;
        }

        case ActionType.TYPE: {
          await locator!.pressSequentially(String(action.value ?? ""), {
            timeout: action.timeout || 10000,
          });
          break;
        }

        case ActionType.PRESS: {
          const key = String(action.value || "Enter");
          if (locator) {
            try {
              await locator.focus().catch(() => {});
              await locator.press(key, { timeout: action.timeout || 10000 });
            } catch {
              await page.keyboard.press(key);
            }
          } else {
            await page.keyboard.press(key);
          }
          break;
        }

        case ActionType.SELECT: {
          await locator!.selectOption(String(action.value || ""), { timeout: action.timeout || 10000 });
          break;
        }

        case ActionType.CHECK: {
          await locator!.check({ timeout: action.timeout || 10000 });
          break;
        }

        case ActionType.UNCHECK: {
          await locator!.uncheck({ timeout: action.timeout || 10000 });
          break;
        }

        case ActionType.HOVER: {
          await locator!.hover({ timeout: action.timeout || 10000 });
          break;
        }

        case ActionType.SCROLL: {
          await page.evaluate(() => window.scrollBy(0, 400));
          break;
        }

        case ActionType.WAIT: {
          if (action.expectedState?.elementAppears) {
            const sel = action.expectedState.elementAppears;
            try {
              if (sel.startsWith("#") || sel.startsWith(".") || sel.startsWith("[")) {
                await page.waitForSelector(sel, { state: "visible", timeout: action.timeout || 10000 });
              } else {
                await page.waitForFunction(
                  (text) => document.body.innerText.toLowerCase().includes(text.toLowerCase()),
                  sel,
                  { timeout: action.timeout || 10000 }
                );
              }
              await page.waitForTimeout(300);
            } catch {
              // Fallback wait
              await page.waitForTimeout(1500);
            }
          } else if (typeof action.value === "string" && (action.value.startsWith("#") || action.value.startsWith(".") || action.value.startsWith("["))) {
            await page.waitForSelector(action.value, { state: "visible", timeout: action.timeout || 10000 }).catch(() => {});
            await page.waitForTimeout(300);
          } else {
            const waitMs = typeof action.value === "number" ? action.value : 1000;
            await page.waitForTimeout(waitMs);
          }
          break;
        }

        case ActionType.EXTRACT_TEXT: {
          if (action.target?.index !== undefined) {
            extractedData = (await locator!.innerText({ timeout: action.timeout || 5000 })).trim();
          } else {
            const matchCount = await locator!.count().catch(() => 1);
            if (matchCount > 1) {
              const texts = await locator!.allInnerTexts().catch(() => []);
              extractedData = texts.map((t) => t.trim()).filter(Boolean);
            } else {
              extractedData = (await locator!.innerText({ timeout: action.timeout || 5000 })).trim();
            }
          }
          break;
        }

        case ActionType.EXTRACT_ATTRIBUTE: {
          const attr = action.attributeName || "href";
          extractedData = await locator!.getAttribute(attr);
          break;
        }

        case ActionType.EXTRACT_TABLE: {
          extractedData = await locator!.evaluate((tableEl) => {
            const rows = Array.from(tableEl.querySelectorAll("tr"));
            return rows.map((row) =>
              Array.from(row.querySelectorAll("th, td")).map((cell) => cell.textContent?.trim() || "")
            );
          });
          break;
        }

        case ActionType.EVALUATE_SAFE: {
          await page.waitForLoadState("domcontentloaded").catch(() => {});
          extractedData = await page.evaluate(() => {
            // Support both standard test fixtures and live e-commerce websites (Flipkart, Amazon, etc.)
            let cards = Array.from(document.querySelectorAll(
              '[data-testid^="product-card"], .product-card, div.grid > div, [data-id], [data-component-type="s-search-result"], div[class*="cPHDOP"], div[class*="_1AtVbE"], div[class*="product-item"], div[class*="productCard"], div[class*="s-result-item"]'
            ));

            if (cards.length === 0) {
              const productLinks = Array.from(document.querySelectorAll('a[href*="/p/"], a[href*="/dp/"], a[href*="/product/"], a[href*="/item/"]'));
              if (productLinks.length > 0) {
                cards = productLinks.map((a) => a.closest('div[class*="col"], div[class*="row"], div[class*="card"], div[class*="item"], div') || a);
              }
            }

            if (cards.length > 0) {
              const seenTitles = new Set<string>();
              const results: Array<{ title: string; name: string; price: string }> = [];

              for (const c of cards) {
                const titleEl =
                  c.querySelector('.product-title, [class*="title" i], [class*="KzDlHZ"], [class*="_4rR01T"], h2, h3, a[title], strong') ||
                  c.querySelector('a');

                const priceEl =
                  c.querySelector('.product-price, [data-testid*="price" i], [class*="product-price" i], [class*="Nx9bqj"], [class*="_30jeq3"]') ||
                  Array.from(c.querySelectorAll('div, span, p, b')).find((el) => {
                    const txt = el.textContent || '';
                    return /(?:₹|Rs\.?|\$|€|£)\s*[\d,]+(?:\.\d{2})?/.test(txt) && !txt.toLowerCase().includes("off");
                  }) ||
                  c.querySelector('[class*="price" i], span');

                const rawTitle = titleEl?.getAttribute('title') || titleEl?.textContent?.trim() || '';
                const rawPrice = priceEl?.textContent?.trim() || '';

                if (rawTitle && rawPrice) {
                  const cleanTitle = rawTitle.replace(/\s+/g, ' ').trim();
                  const priceMatch = rawPrice.match(/(?:₹|Rs\.?|\$|€|£)\s*[\d,]+(?:\.\d{2})?/);
                  const cleanPrice = priceMatch ? priceMatch[0] : rawPrice;

                  if (!seenTitles.has(cleanTitle) && cleanTitle.length >= 3) {
                    seenTitles.add(cleanTitle);
                    results.push({
                      title: cleanTitle,
                      name: cleanTitle,
                      price: cleanPrice,
                    });
                  }
                }
              }

              if (results.length > 0) {
                return results;
              }
            }
            return null;
          });
          break;
        }

        case ActionType.DOWNLOAD: {
          // If click is required to trigger download
          if (locator) {
            try {
              const [download] = await Promise.all([
                page.waitForEvent("download", { timeout: action.timeout || 10000 }),
                locator.click(),
              ]);
              downloadPath = await download.path().catch(() => undefined);
            } catch {
              // Fallback: check if browserManager captured the download
              await page.waitForTimeout(1000);
              const dls = browserManager.getDownloads();
              if (dls.length > 0) {
                downloadPath = dls[dls.length - 1].savedPath;
              }
            }
          }
          break;
        }

        case ActionType.UPLOAD: {
          const filePath = String(action.value || "");
          if (!filePath) {
            throw new AgentError("Upload action missing file path in value", ErrorCode.VALIDATION_FAILED, false);
          }

          // Check for sensitive files requiring confirmation
          const lowerPath = filePath.toLowerCase();
          const baseName = filePath.split(/[/\\]/).pop() || filePath;
          if (
            lowerPath.includes(".env") ||
            lowerPath.includes("id_rsa") ||
            lowerPath.includes(".pem") ||
            lowerPath.includes("credentials") ||
            lowerPath.includes("password")
          ) {
            throw new AgentError(
              `Upload of sensitive file '${baseName}' requires explicit user confirmation.`,
              ErrorCode.VALIDATION_FAILED,
              false,
              { file: baseName }
            );
          }

          const resolved = await LocalFileResolver.resolveFile({
            pathOrName: filePath,
            searchDirectory: process.cwd(),
          });

          const fileInput = locator || page.locator('input[type="file"]').first();
          await fileInput.setInputFiles(resolved.canonicalPath, { timeout: action.timeout || 10000 });
          extractedData = {
            uploadedFile: resolved.filename,
            canonicalPath: resolved.canonicalPath,
            sizeBytes: resolved.sizeBytes,
          };
          break;
        }

        case ActionType.MEDIA_PLAY: {
          // Check for visible Play control button across standard and custom web players
          const visiblePlayBtnLocator = page.locator(
            "#audio-play-button:visible, button#audio-play-button:visible, button[data-testid='play-button']:visible, button[data-testid='action-bar-row-play-button']:visible, button.ytp-play-button:visible, .ytp-large-play-button:visible, button[data-testid*='playpause'][aria-label*='Play' i]:visible, button[aria-label*='Play' i]:visible, button[title*='Play' i]:visible, [role='button'][aria-label*='Play' i]:visible, .play-button:visible, button:has-text('Play'):visible"
          ).first();
          const hasVisiblePlayBtn = await visiblePlayBtnLocator.isVisible().catch(() => false);

          let isHtmlMediaPlaying = false;
          const mediaCheckLoc = page.locator("video, audio");
          const mediaCheckCount = await mediaCheckLoc.count().catch(() => 0);
          if (mediaCheckCount > 0) {
            // Immediate check for existing fatal media error
            const initialError = await mediaCheckLoc.first().evaluate((el: HTMLMediaElement) => {
              if (el.error) {
                return el.error.message || `MediaError_${el.error.code}`;
              }
              return null;
            }).catch(() => null);

            if (initialError) {
              const errorState = {
                isPlaying: false,
                isPaused: true,
                error: initialError,
                playbackVerified: false,
              };
              extractedData = errorState;
              throw new AgentError(
                `Media playback failed with element error: ${initialError}`,
                ErrorCode.VERIFICATION_FAILED,
                false,
                { playbackEvidence: errorState }
              );
            }

            if (typeof mediaCheckLoc.evaluateAll === "function") {
              isHtmlMediaPlaying = await mediaCheckLoc.evaluateAll((elements) => {
                return elements.some((m) => {
                  const el = m as HTMLMediaElement;
                  // Must be active and not muted background loop when Play button is still visible
                  return !el.paused && !el.ended && el.currentTime > 0 && (!el.muted || elements.length === 1);
                });
              }).catch(() => false);
            } else if (typeof mediaCheckLoc.first === "function") {
              isHtmlMediaPlaying = await mediaCheckLoc.first().evaluate((el: any) => {
                if (typeof el === "object" && el.isPlaying !== undefined) return Boolean(el.isPlaying);
                return !el.paused && !el.ended && el.currentTime > 0;
              }).catch(() => false);
            }
          }

          const isUiPlayerPlaying = await page.evaluate(() => {
            const pauseControls = Array.from(
              document.querySelectorAll<HTMLElement>(
                "button.ytp-play-button[data-title-no-tooltip='Pause'], button[aria-label*='Pause' i], [role='button'][aria-label*='Pause' i], button[title*='Pause' i], [data-testid*='playpause'][aria-label*='Pause' i]"
              )
            );
            return pauseControls.some((el) => {
              const rect = el.getBoundingClientRect();
              const style = window.getComputedStyle(el);
              const isEnabled = !el.hasAttribute("disabled") && !(el as HTMLButtonElement).disabled && el.getAttribute("aria-disabled") !== "true";
              return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && isEnabled;
            });
          }).catch(() => false);

          // If a visible Play button is present, playback has NOT yet been engaged by the user
          if (!hasVisiblePlayBtn && (isHtmlMediaPlaying || isUiPlayerPlaying)) {
            // Media playback was already established (e.g. autoplay or track link auto-start)
            extractedData = {
              trackFound: true,
              trackOpened: true,
              playbackAttempted: true,
              playbackVerified: true,
              isBlocked: false,
              isPlaying: true,
              isPaused: false,
              currentTime: 1,
              duration: 0,
              readyState: 4,
              error: null,
              mode: isHtmlMediaPlaying ? "html_media" : "ui_player",
            };
            break;
          }

          // Dismiss cookie/consent overlay if blocking the player
          await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>("button"));
            const consentBtn = buttons.find((b) => {
              const t = (b.innerText || b.getAttribute("aria-label") || "").toLowerCase().trim();
              return /^(?:accept\s+all|i\s+agree|agree|reject\s+all|dismiss|got\s+it|accept)$/i.test(t);
            });
            if (consentBtn && consentBtn.offsetParent !== null) {
              consentBtn.click();
            }
          }).catch(() => {});

          // 2. Not playing yet: Trigger playback via Play control or HTMLMediaElement
          const mediaLoc = locator || page.locator("video, audio").first();
          const mediaCount = await mediaLoc.count().catch(() => 0);

          if (hasVisiblePlayBtn) {
            await visiblePlayBtnLocator.click({ timeout: action.timeout || 5000 }).catch(() => {});
          } else if (mediaCount > 0) {
            await mediaLoc.evaluate((el: HTMLMediaElement) => {
              if (el.play) {
                return el.play().catch(() => {});
              }
            }).catch(() => {});
            await mediaLoc.click({ timeout: action.timeout || 5000 }).catch(() => {});
          } else {
            const missingControlState = {
              trackFound: true,
              trackOpened: true,
              playbackAttempted: false,
              playbackVerified: false,
              isBlocked: false,
              controlFound: false,
              error: "No media element or Play control found on page",
            };
            extractedData = missingControlState;
            throw new AgentError("No media element or Play control found on page", ErrorCode.ELEMENT_NOT_FOUND, false, { playbackEvidence: missingControlState });
          }

          // 3. Wait and poll for playback to engage and state to settle
          let isPlaybackActive = false;
          let finalHtmlState: any = null;
          let finalUiPauseVisible = false;

          for (let poll = 0; poll < 6; poll++) {
            await page.waitForTimeout(500);

            const hasHtmlMediaAfter = (await page.locator("video, audio").count().catch(() => 0)) > 0;
            finalHtmlState = hasHtmlMediaAfter
              ? await page.locator("video, audio").first().evaluate((el: HTMLMediaElement) => ({
                  isPlaying: !el.paused && !el.ended,
                  isPaused: el.paused,
                  currentTime: el.currentTime,
                  duration: el.duration,
                  readyState: el.readyState,
                  error: el.error ? el.error.message || `MediaError_${el.error.code}` : null,
                })).catch(() => null)
              : null;

            finalUiPauseVisible = await page.evaluate(() => {
              const pauseControls = Array.from(
                document.querySelectorAll<HTMLElement>(
                  "button.ytp-play-button[data-title-no-tooltip='Pause'], button[aria-label*='Pause' i], [role='button'][aria-label*='Pause' i], button[title*='Pause' i], [data-testid*='playpause'][aria-label*='Pause' i]"
                )
              );
              return pauseControls.some((el) => {
                const rect = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                const isEnabled = !el.hasAttribute("disabled") && !(el as HTMLButtonElement).disabled && el.getAttribute("aria-disabled") !== "true";
                return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && isEnabled;
              });
            }).catch(() => false);

            if (finalHtmlState && finalHtmlState.error) {
              break;
            }

            if ((finalHtmlState && finalHtmlState.isPlaying) || finalUiPauseVisible) {
              isPlaybackActive = true;
              break;
            }
          }

          // Check for explicit media element error
          if (finalHtmlState && finalHtmlState.error) {
            const errorState = {
              isPlaying: false,
              isPaused: true,
              error: finalHtmlState.error,
              playbackVerified: false,
            };
            extractedData = errorState;
            throw new AgentError(`Media playback failed with element error: ${finalHtmlState.error}`, ErrorCode.VERIFICATION_FAILED, false, { playbackEvidence: errorState });
          }

          // Check for content owner restriction or video unavailable
          const isUnavailable = await page.evaluate(() => {
            const body = document.body ? document.body.innerText : "";
            return /\b(?:video\s+unavailable|this\s+video\s+is\s+private|this\s+video\s+is\s+not\s+available|track\s+unavailable)\b/i.test(body);
          }).catch(() => false);

          if (isUnavailable) {
            const unavailState = { isPlaying: false, isPaused: true, isUnavailable: true, playbackVerified: false };
            extractedData = unavailState;
            throw new AgentError("Media is unavailable or restricted by content owner.", ErrorCode.VERIFICATION_FAILED, false, { playbackEvidence: unavailState });
          }

          if (isPlaybackActive) {
            extractedData = {
              trackFound: true,
              trackOpened: true,
              playbackAttempted: true,
              playbackVerified: true,
              isBlocked: false,
              isPlaying: true,
              isPaused: false,
              currentTime: finalHtmlState?.currentTime || 1,
              duration: finalHtmlState?.duration || 0,
              readyState: finalHtmlState?.readyState || 4,
              error: null,
              mode: finalUiPauseVisible ? "ui_player" : "html_media",
            };
            break;
          }

          // 5. Playback did NOT start: inspect whether an authentication or subscription restriction blocked it
          const restriction = await page.evaluate(() => {
            const bodyText = document.body ? document.body.innerText : "";
            const containers = Array.from(document.querySelectorAll(
              "[role='alert'], [role='dialog'], [role='banner'], [data-testid*='banner'], [data-testid*='modal'], [data-testid*='prompt'], [data-testid*='lyrics'], [class*='lyrics'], [class*='banner'], [class*='modal'], [class*='auth'], [class*='login'], [class*='prompt'], [class*='upsell'], [class*='gate'], [id*='banner'], [id*='modal'], [id*='auth'], aside, header"
            ));
            const candidateTexts = [
              bodyText,
              ...containers.map((c) => c.textContent || ""),
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

            for (const text of candidateTexts) {
              for (const p of AUTH_PATTERNS) {
                const match = text.match(p);
                if (match) return { type: "AUTH_REQUIRED" as const, matchedText: match[0].trim() };
              }
              for (const p of SUB_PATTERNS) {
                const match = text.match(p);
                if (match) return { type: "SUBSCRIPTION_REQUIRED" as const, matchedText: match[0].trim() };
              }
            }
            return null;
          }).catch(() => null);

          if (restriction) {
            const reason = restriction.type === "AUTH_REQUIRED"
              ? `Access restricted: Target page requires manual sign-in to play media ("${restriction.matchedText}"). Execution halted safely without attempting automated bypass. Please sign in manually in the visible browser window to continue.`
              : `Access restricted: Target page requires a paid subscription to play media ("${restriction.matchedText}"). Execution halted safely without attempting automated bypass.`;

            const blockedState = {
              trackFound: true,
              trackOpened: true,
              playbackAttempted: true,
              playbackVerified: false,
              isBlocked: true,
              blockType: restriction.type,
              reason,
              isPlaying: false,
              isPaused: true,
              error: reason,
            };
            extractedData = blockedState;
            throw new AgentError(reason, ErrorCode.AUTH_REQUIRED, false, { playbackEvidence: blockedState });
          }

          // 6. No auth restriction, but media remained paused after clicking Play control
          const pausedState = {
            trackFound: true,
            trackOpened: true,
            playbackAttempted: true,
            playbackVerified: false,
            isBlocked: false,
            isPlaying: false,
            isPaused: true,
            currentTime: 0,
            duration: 0,
            readyState: 0,
            error: "Media element remained paused. Playback was not established after clicking play control.",
          };
          extractedData = pausedState;
          throw new AgentError(pausedState.error, ErrorCode.VERIFICATION_FAILED, true, { playbackEvidence: pausedState });
        }

        case ActionType.MEDIA_PAUSE: {
          const mediaLoc = locator || page.locator("video, audio").first();
          const count = await mediaLoc.count().catch(() => 0);
          if (count === 0) {
            const pauseBtn = page.getByRole("button", { name: /pause/i }).first();
            if (await pauseBtn.isVisible().catch(() => false)) {
              await pauseBtn.click({ timeout: action.timeout || 5000 });
            } else {
              throw new AgentError("No media element or Pause control found on page", ErrorCode.ELEMENT_NOT_FOUND, false);
            }
          } else {
            await mediaLoc.evaluate((el: HTMLMediaElement) => {
              if (el.pause) el.pause();
            });
          }
          await page.waitForTimeout(100);
          const state = await page.locator("video, audio").first().evaluate((el: HTMLMediaElement) => ({
            isPlaying: !el.paused && !el.ended,
            isPaused: el.paused,
            currentTime: el.currentTime,
          })).catch(() => ({ isPlaying: false, isPaused: true, currentTime: 0 }));
          extractedData = state;
          break;
        }

        case ActionType.MEDIA_MUTE: {
          const mediaLoc = locator || page.locator("video, audio").first();
          const count = await mediaLoc.count().catch(() => 0);
          if (count === 0) {
            const muteBtn = page.getByRole("button", { name: /mute/i }).first();
            if (await muteBtn.isVisible().catch(() => false)) {
              await muteBtn.click({ timeout: action.timeout || 5000 });
            } else {
              throw new AgentError("No media element or Mute control found on page", ErrorCode.ELEMENT_NOT_FOUND, false);
            }
          } else {
            await mediaLoc.evaluate((el: HTMLMediaElement) => {
              el.muted = true;
            });
          }
          extractedData = { isMuted: true };
          break;
        }

        case ActionType.MEDIA_SEEK: {
          const targetSeconds = Number(action.value || 0);
          const mediaLoc = locator || page.locator("video, audio").first();
          await mediaLoc.evaluate((el: HTMLMediaElement, sec) => {
            el.currentTime = sec;
          }, targetSeconds);
          extractedData = { currentTime: targetSeconds };
          break;
        }

        case ActionType.MEDIA_VOLUME: {
          const targetVol = Math.max(0, Math.min(1, Number(action.value ?? 1)));
          const mediaLoc = locator || page.locator("video, audio").first();
          await mediaLoc.evaluate((el: HTMLMediaElement, vol) => {
            el.volume = vol;
          }, targetVol);
          extractedData = { volume: targetVol };
          break;
        }

        case ActionType.SCREENSHOT: {
          const buffer = await page.screenshot({ fullPage: false });
          extractedData = `data:image/png;base64,${buffer.toString("base64")}`;
          break;
        }

        case ActionType.OPEN_NEW_TAB: {
          let tabUrl = String(action.value || "");
          if (!tabUrl && locator) {
            tabUrl = (await locator.getAttribute("href")) || "";
            if (tabUrl && !tabUrl.startsWith("http")) {
              tabUrl = new URL(tabUrl, page.url()).toString();
            }
          }
          if (tabUrl) {
            validateUrlString(tabUrl, "action execution open_new_tab");
          }
          const newTab = await browserManager.openNewTab(tabUrl);
          extractedData = { newTabId: newTab.tabId, url: tabUrl };
          break;
        }

        case ActionType.SWITCH_TAB: {
          await browserManager.switchTab(String(action.value || ""));
          break;
        }

        case ActionType.CLOSE_TAB: {
          await browserManager.closeTab(String(action.value || tabId));
          break;
        }

        case ActionType.INSPECT: {
          extractedData = await PageObserver.observe(page, tabId);
          break;
        }

        case ActionType.REQUEST_CLARIFICATION: {
          extractedData = {
            needsClarification: true,
            reason: String(action.value || action.reason || "User clarification requested"),
          };
          break;
        }

        case ActionType.FINISH: {
          // Terminal action, no-op
          break;
        }

        default:
          break;
      }
 
      // Stabilization wait for dynamic DOM changes & in-flight navigations (Step 3 & Step 7)
      await ActionExecutor.stabilizeState({
        page,
        action,
        beforeUrl: currentObs.url,
      });

      // 4. Observe state after action
      const afterObservation = await PageObserver.observe(page, tabId);

      // 5. Post-Action Verification (Part 3 & Part 9)
      const allDownloads = browserManager.getDownloads();
      const latestDownload = allDownloads.length > 0 ? allDownloads[allDownloads.length - 1] : undefined;
      if (latestDownload && !downloadPath) {
        downloadPath = latestDownload.savedPath;
      }

      const verification = ActionVerifier.verifyAction({
        action,
        beforeObservation: currentObs,
        afterObservation,
        extractedValue: extractedData,
        downloadedArtifact: latestDownload,
      });

      if (!verification.verified) {
        throw new AgentError(
          `Action verification failed: ${verification.reason}`,
          ErrorCode.VERIFICATION_FAILED,
          true,
          { action, details: verification.details }
        );
      }

      const executionResult: ActionExecutionResult = {
        actionId: action.id,
        taskId,
        stepIndex,
        userIntent: action.userIntent || action.reason,
        type: action.type,
        status: ActionStatus.COMPLETED,
        currentUrl: currentObs.url,
        targetDescription: action.targetDescription || action.target?.value,
        validationResult: {
          valid: validation.valid,
          reason: validation.reason,
          strategyUsed: validation.strategyUsed,
          isSafeToRetry: validation.isSafeToRetry,
          skipAction: validation.skipAction,
          requiresConfirmation: validation.requiresUserConfirmation,
        },
        startTime,
        endTime: new Date().toISOString(),
        durationMs: Date.now() - startMs,
        extractedData,
        downloadPath: downloadPath || latestDownload?.savedPath,
        retriesUsed: 0,
        resultingState: {
          url: afterObservation.url,
          title: afterObservation.title,
          isSettled: afterObservation.isSettled,
        },
        verificationEvidence: verification.details as Record<string, unknown>,
        verified: true,
      };

      return {
        result: executionResult,
        afterObservation,
        resolvedLocator: locator || validation.resolvedLocator,
      };
    } catch (error) {
      // Capture failure diagnostics
      const agentError =
        error instanceof AgentError
          ? error
          : new AgentError(
              error instanceof Error ? error.message : "Execution failed",
              ErrorCode.UNKNOWN_ERROR,
              true
            );

      const afterObservation = await PageObserver.observe(page, tabId).catch(() => currentObs);

      const executionResult: ActionExecutionResult = {
        actionId: action.id,
        taskId,
        stepIndex,
        userIntent: action.userIntent || action.reason,
        type: action.type,
        status: ActionStatus.FAILED,
        currentUrl: currentObs.url,
        targetDescription: action.targetDescription || action.target?.value,
        validationResult: {
          valid: false,
          reason: agentError.message,
          isSafeToRetry: agentError.recoverable,
        },
        startTime,
        endTime: new Date().toISOString(),
        durationMs: Date.now() - startMs,
        error: {
          code: agentError.code,
          message: agentError.message,
          details: agentError.context,
          recoverable: agentError.recoverable,
          category: agentError.code,
        },
        retriesUsed: 0,
        resultingState: {
          url: afterObservation.url,
          title: afterObservation.title,
          isSettled: afterObservation.isSettled,
        },
        verified: false,
      };

      return {
        result: executionResult,
        afterObservation,
      };
    }
  }

  /**
   * Waits for explicit state transitions (URL changes, DOM updates, confirmation dialogs)
   * rather than relying exclusively on fixed arbitrary delays (Step 3 & Step 7).
   */
  private static async stabilizeState(params: {
    page: Page;
    action: Action;
    beforeUrl: string;
  }): Promise<void> {
    const { page, action, beforeUrl } = params;

    // 1. Explicit expected state transitions
    if (action.expectedState) {
      const exp = action.expectedState;

      if (exp.urlChange) {
        try {
          await page.waitForFunction(
            (prev) => window.location.href !== prev,
            beforeUrl,
            { timeout: 3000 }
          );
        } catch {
          // Bounded fallback
        }
      }

      if (exp.expectedUrlPattern) {
        try {
          const pat = exp.expectedUrlPattern;
          await page.waitForFunction(
            (pattern) => new RegExp(pattern, "i").test(window.location.href),
            pat,
            { timeout: 3000 }
          );
        } catch {
          // Bounded fallback
        }
      }

      if (exp.elementAppears) {
        try {
          const sel = exp.elementAppears;
          if (sel.startsWith("#") || sel.startsWith(".") || sel.startsWith("[")) {
            await page.waitForSelector(sel, { state: "visible", timeout: 3000 });
          } else {
            await page.waitForFunction(
              (text) => document.body.innerText.toLowerCase().includes(text.toLowerCase()),
              sel,
              { timeout: 3000 }
            );
          }
        } catch {
          // Bounded fallback
        }
      }

      if (exp.elementDisappears) {
        try {
          await page.waitForSelector(exp.elementDisappears, { state: "hidden", timeout: 3000 });
        } catch {
          // Bounded fallback
        }
      }

      if (exp.textContains) {
        try {
          await page.waitForFunction(
            (txt) => document.body.innerText.toLowerCase().includes(txt.toLowerCase()),
            exp.textContains,
            { timeout: 3000 }
          );
        } catch {
          // Bounded fallback
        }
      }
    }

    // 2. Action-type specific stabilization
    if (
      action.type === ActionType.NAVIGATE ||
      action.type === ActionType.BACK ||
      action.type === ActionType.FORWARD ||
      action.type === ActionType.RELOAD ||
      action.type === ActionType.CLICK ||
      action.type === ActionType.PRESS
    ) {
      // Avoid networkidle as a universal requirement because modern sites have long-polling connections.
      // Wait for domcontentloaded with a bounded timeout (up to 3000ms).
      if (typeof page.waitForLoadState === "function") {
        await page.waitForLoadState("domcontentloaded", { timeout: 3000 }).catch(() => {});
      }

      // Settle rapid DOM mutations via micro-animation frame
      if (typeof page.evaluate === "function") {
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 150)))).catch(() => {});
      }
    } else {
      // Gentle settle for input fills or hovers
      if (typeof page.waitForTimeout === "function") {
        await page.waitForTimeout(100);
      }
    }
  }
}

