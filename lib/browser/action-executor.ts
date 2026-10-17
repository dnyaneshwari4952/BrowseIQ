import { Page, Locator } from "playwright";
import { Action, ActionExecutionResult, ActionStatus, ActionType } from "../types/actions";
import { PageObservation } from "../types/browser";
import { ErrorCode, AgentError } from "../types/errors";
import { PreExecutionValidator } from "../validation/pre-execution-validator";
import { ActionVerifier } from "../agent/action-verifier";
import { PageObserver } from "./page-observer";
import { browserManager } from "./browser-manager";

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
  }): Promise<{
    result: ActionExecutionResult;
    afterObservation: PageObservation;
    resolvedLocator?: Locator;
  }> {
    const { action, page, tabId, beforeObservation, lastResolvedLocator } = params;
    const startTime = new Date().toISOString();
    const startMs = Date.now();

    // 1. Observe state before action if not already provided
    const currentObs = beforeObservation || (await PageObserver.observe(page, tabId));

    try {
      // 2. Pre-Execution Validation Guardrail (Part 8)
      const validation = await PreExecutionValidator.validate({
        action,
        page,
        currentObservation: currentObs,
        lastResolvedLocator,
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
            type: action.type,
            status: ActionStatus.COMPLETED,
            startTime,
            endTime: new Date().toISOString(),
            durationMs: Date.now() - startMs,
            retriesUsed: 0,
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
          await page.goto(targetUrl, {
            waitUntil: "domcontentloaded",
            timeout: action.timeout || 30000,
          });
          break;
        }

        case ActionType.CLICK: {
          await locator!.click({ timeout: action.timeout || 10000 });
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
            } catch {
              // Fallback wait
              await page.waitForTimeout(1500);
            }
          } else if (typeof action.value === "string" && (action.value.startsWith("#") || action.value.startsWith(".") || action.value.startsWith("["))) {
            await page.waitForSelector(action.value, { state: "visible", timeout: action.timeout || 10000 }).catch(() => {});
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
          extractedData = await page.evaluate(() => {
            const cards = Array.from(document.querySelectorAll('[data-testid^="product-card"], .product-card, div.grid > div'));
            if (cards.length > 0) {
              return cards.map((c) => {
                const titleEl = c.querySelector('.product-title, h3, h2, strong');
                const priceEl =
                  c.querySelector('.product-price, [data-testid*="price"], [class*="product-price"]') ||
                  Array.from(c.querySelectorAll('div, span, p')).find((el) => /₹|\$|\b\d{2,}(?:,\d{3})*\b/.test(el.textContent || '')) ||
                  c.querySelector('[class*="price"], span');
                return {
                  title: titleEl?.textContent?.trim() || '',
                  name: titleEl?.textContent?.trim() || '',
                  price: priceEl?.textContent?.trim() || '',
                };
              }).filter((p) => p.title || p.price);
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

        case ActionType.FINISH: {
          // Terminal action, no-op
          break;
        }

        default:
          break;
      }

      // Small stabilization wait for dynamic DOM changes
      await page.waitForTimeout(200);

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
        type: action.type,
        status: ActionStatus.COMPLETED,
        startTime,
        endTime: new Date().toISOString(),
        durationMs: Date.now() - startMs,
        extractedData,
        downloadPath: downloadPath || latestDownload?.savedPath,
        retriesUsed: 0,
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
        type: action.type,
        status: ActionStatus.FAILED,
        startTime,
        endTime: new Date().toISOString(),
        durationMs: Date.now() - startMs,
        error: {
          code: agentError.code,
          message: agentError.message,
          details: agentError.context,
        },
        retriesUsed: 0,
        verified: false,
      };

      return {
        result: executionResult,
        afterObservation,
      };
    }
  }
}
