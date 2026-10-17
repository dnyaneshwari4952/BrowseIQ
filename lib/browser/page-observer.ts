import { Page } from "playwright";
import { ObservedElement, PageObservation } from "../types/browser";
import { LocatorStrategy } from "../types/actions";

/**
 * Token-efficient Page Observer (Section 7)
 * Extracts a normalized, structured DOM snapshot without flooding LLM context.
 */
export class PageObserver {
  /**
   * Captures a normalized snapshot of the active browser page.
   */
  static async observe(page: Page, tabId = "tab-1"): Promise<PageObservation> {
    try {
      const url = page.url();
      const title = await page.title().catch(() => "");

      // Execute browser-side extraction script
      const rawObservation = await page.evaluate(() => {
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
          isVisible: boolean;
          isEnabled: boolean;
          isChecked?: boolean;
          isSelected?: boolean;
        }> = [];

        // Select interactive candidates
        const nodes = document.querySelectorAll(
          'button, a, input, select, textarea, [role="button"], [role="link"], [role="textbox"], [role="checkbox"], [tabindex="0"]'
        );

        let count = 0;
        nodes.forEach((node) => {
          if (count > 80) return; // Cap to keep token size compact
          const el = node as HTMLElement;
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
            isVisible,
            isEnabled,
            isChecked,
          });
        });

        // Collect top headings
        const headings: string[] = [];
        document.querySelectorAll("h1, h2, h3").forEach((h) => {
          const t = (h.textContent || "").trim();
          if (t && headings.length < 8) headings.push(t);
        });

        // Collect forms
        const forms: Array<{ id?: string; action?: string; inputs: string[] }> = [];
        document.querySelectorAll("form").forEach((f) => {
          const inputs: string[] = [];
          f.querySelectorAll("input, textarea, select").forEach((inp) => {
            const n = inp.getAttribute("name") || inp.getAttribute("id");
            if (n) inputs.push(n);
          });
          forms.push({
            id: f.id || undefined,
            action: f.getAttribute("action") || undefined,
            inputs,
          });
        });

        return { interactiveElements, headings, forms };
      });

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

      const summary = `PAGE: "${title}" (URL: ${url}). Headings: [${rawObservation.headings.join(", ")}]. Elements: ${visibleCount} visible (${buttonCount} buttons, ${inputCount} inputs, ${linkCount} links).`;

      return {
        url,
        title,
        headings: rawObservation.headings,
        interactiveElements: enrichedElements,
        forms: rawObservation.forms,
        dialogs: [],
        summary,
        timestamp: new Date().toISOString(),
        tabId,
      };
    } catch (err) {
      return {
        url: page.url(),
        title: "",
        headings: [],
        interactiveElements: [],
        forms: [],
        dialogs: [],
        summary: `Observation failed: ${err instanceof Error ? err.message : "Unknown error"}`,
        timestamp: new Date().toISOString(),
        tabId,
      };
    }
  }
}
