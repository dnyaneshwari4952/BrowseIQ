import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, Browser, Page } from "playwright";
import { SearchResultResolver } from "../../lib/browser/search-result-resolver";
import { ActionExecutor } from "../../lib/browser/action-executor";
import { DynamicTaskPlanner } from "../../lib/planning/dynamic-task-planner";
import { EntityConstraintResolver } from "../../lib/planning/entity-constraint-resolver";
import { TaskVerifier } from "../../lib/agent/task-verifier";
import { RecoveryEngine } from "../../lib/agent/recovery-engine";
import { PreExecutionValidator } from "../../lib/validation/pre-execution-validator";
import { ActionType, ActionStatus, RiskLevel } from "../../lib/types/actions";
import { ErrorCode } from "../../lib/types/errors";
import { PageObservation } from "../../lib/types/browser";

describe("Generalized Search Result Disambiguation, Semantic Clicking & Verification (18 Test Matrix)", () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
  });

  afterAll(async () => {
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  });

  // 1. Result with a title link and thumbnail link pointing to the same destination (Deduplication)
  it("1. Deduplicates thumbnail link and title link within the same result card to the primary title link", async () => {
    await page.setContent(`
      <!DOCTYPE html>
      <html>
      <body>
        <div id="results">
          <div class="result-card" id="card-media-42">
            <a class="thumb-link" href="/media/42">
              <img src="/thumb.jpg" alt="Preview Thumbnail" />
            </a>
            <div class="meta">
              <a class="title-link" href="/media/42" id="title-link-42">
                <h3>Kya Baat Haii 2.0 Official Music Video</h3>
              </a>
              <p class="description">Harrdy Sandhu, Nikhita Gandhi - Official Video</p>
            </div>
          </div>
        </div>
      </body>
      </html>
    `);

    const resolution = await SearchResultResolver.resolveSearchResult(page, {
      query: "kya baat hai",
    });

    expect(resolution.status).toBe("resolved");
    expect(resolution.selectedCandidate).toBeDefined();
    // Must select the title link rather than the thumbnail link
    expect(resolution.selectedCandidate?.isTitleLink).toBe(true);
    expect(resolution.selectedCandidate?.isThumbnail).toBe(false);
    expect(resolution.selectedCandidate?.id).toContain("card-media-42");
    expect(resolution.deduplicatedCount).toBeGreaterThanOrEqual(1);
  });

  // 2. Duplicate selectors resolving to one DOM element
  it("2. Deduplicates multiple selectors resolving to the identical DOM element without triggering ambiguity", async () => {
    await page.setContent(`
      <!DOCTYPE html>
      <html>
      <body>
        <main>
          <div class="search-feed">
            <article id="art-01">
              <a id="unique-article-target" class="main-link highlight" href="/posts/deep-learning" title="Deep Learning Architecture">
                Deep Learning Architecture
              </a>
            </article>
          </div>
        </main>
      </body>
      </html>
    `);

    const resolution = await SearchResultResolver.resolveSearchResult(page, {
      query: "Deep Learning Architecture",
    });

    expect(resolution.status).toBe("resolved");
    expect(resolution.selectedCandidate?.url).toContain("/posts/deep-learning");
    expect(resolution.distinctResultsCount).toBe(1);
  });

  // 3. Two distinct results with similar titles (Ranking official/primary above tutorials/reactions)
  it("3. Ranks primary official result above derivative tutorial and reaction videos", async () => {
    await page.setContent(`
      <!DOCTYPE html>
      <html>
      <body>
        <div id="search-results">
          <div class="result-card" id="res-tut">
            <a href="/watch?v=tut" class="video-title">Kya Baat Hai - Easy Guitar Lesson & Chords Tutorial</a>
          </div>
          <div class="result-card" id="res-official">
            <a href="/watch?v=official" class="video-title">Kya Baat Hai 2.0 (Official Video) - Harrdy Sandhu</a>
          </div>
          <div class="result-card" id="res-react">
            <a href="/watch?v=react" class="video-title">Vocal Coach Reacts to Kya Baat Hai Song</a>
          </div>
        </div>
      </body>
      </html>
    `);

    const resolution = await SearchResultResolver.resolveSearchResult(page, {
      query: "Kya Baat Hai song",
    });

    expect(resolution.status).toBe("resolved");
    expect(resolution.selectedCandidate?.url).toContain("watch?v=official");
    expect(resolution.selectedCandidate?.title).toContain("Official Video");
    expect(resolution.selectedCandidate?.score).toBeGreaterThan(0.7);
  });

  // 4. Exact result competing with broad partial-text match
  it("4. Selects exact title match with high margin over broad partial-text match", async () => {
    await page.setContent(`
      <!DOCTYPE html>
      <html>
      <body>
        <div class="results">
          <div class="result-item">
            <a href="/wiki/Quantum_computing_in_commercial_banking" class="entry">
              Quantum Computing in Commercial Banking and Financial Markets (Overview)
            </a>
          </div>
          <div class="result-item">
            <a href="/wiki/Quantum_computing" class="entry">
              Quantum computing
            </a>
          </div>
        </div>
      </body>
      </html>
    `);

    const resolution = await SearchResultResolver.resolveSearchResult(page, {
      query: "Quantum computing",
    });

    expect(resolution.status).toBe("resolved");
    expect(resolution.selectedCandidate?.url).toContain("/wiki/Quantum_computing");
    expect(resolution.selectedCandidate?.matchType).toBe("exact");
    expect(resolution.diagnostics.scoreMargin).toBeGreaterThanOrEqual(0.1);
  });

  // 5. Hidden duplicate controls bypassed in favor of visible result
  it("5. Bypasses hidden duplicate candidate and selects the visible actionable result", async () => {
    await page.setContent(`
      <!DOCTYPE html>
      <html>
      <body>
        <div style="display: none;" id="offscreen-nav">
          <a href="/archive/item" class="title">Autonomous Navigation Systems</a>
        </div>
        <div id="main-content">
          <div class="result-card">
            <a href="/active/item" class="title">Autonomous Navigation Systems</a>
          </div>
        </div>
      </body>
      </html>
    `);

    const resolution = await SearchResultResolver.resolveSearchResult(page, {
      query: "Autonomous Navigation Systems",
    });

    expect(resolution.status).toBe("resolved");
    expect(resolution.selectedCandidate?.url).toContain("/active/item");
    expect(resolution.selectedCandidate?.isVisible).toBe(true);
  });

  // 6. Stale locator after search results update
  it("6. Revalidates and re-locates candidate when DOM element detaches or re-renders", async () => {
    await page.setContent(`
      <!DOCTYPE html>
      <html>
      <body>
        <div id="results">
          <div class="result-item" id="item-initial">
            <a href="/docs/playwright-api" id="doc-link">Playwright Automation API</a>
          </div>
        </div>
      </body>
      </html>
    `);

    const resolution = await SearchResultResolver.resolveSearchResult(page, {
      query: "Playwright Automation API",
    });

    expect(resolution.status).toBe("resolved");
    const candidate = resolution.selectedCandidate!;

    // Simulate React/SPA re-render replacing the DOM node
    await page.evaluate(() => {
      const container = document.getElementById("results")!;
      container.innerHTML = `
        <div class="result-item" id="item-rerendered">
          <a href="/docs/playwright-api" id="doc-link-new">Playwright Automation API (v2)</a>
        </div>
      `;
    });

    // Revalidate and locate should transparently find the refreshed DOM node
    const revalidatedLocator = await SearchResultResolver.revalidateAndLocate(page, candidate);
    expect(await revalidatedLocator.isVisible()).toBe(true);
    expect(await revalidatedLocator.innerText()).toContain("Playwright Automation API");
  });

  // 7. Result whose URL does not contain watch, track, or video
  it("7. Resolves results with arbitrary URL patterns (/article/, /item/, /doc/) without URL assumptions", async () => {
    await page.setContent(`
      <!DOCTYPE html>
      <html>
      <body>
        <div class="search-feed">
          <article class="feed-item">
            <a href="/archive/doc/884920" class="entry-link">
              <h3>Deep Residual Learning for Image Recognition</h3>
            </a>
            <p>Kaiming He, Xiangyu Zhang, Shaoqing Ren, Jian Sun</p>
          </article>
        </div>
      </body>
      </html>
    `);

    const resolution = await SearchResultResolver.resolveSearchResult(page, {
      query: "Deep Residual Learning for Image Recognition",
    });

    expect(resolution.status).toBe("resolved");
    expect(resolution.selectedCandidate?.url).toContain("/archive/doc/884920");
    expect(resolution.selectedCandidate?.title).toContain("Deep Residual Learning");
  });

  // 8. Site using accessible roles and names rather than familiar CSS classes
  it("8. Resolves result using accessible ARIA roles and labels when classes are non-standard", async () => {
    await page.setContent(`
      <!DOCTYPE html>
      <html>
      <body>
        <div role="region" aria-label="Search Output">
          <div role="article" aria-labelledby="h-acc-1">
            <a role="link" href="/portal/resource/123" aria-label="National Weather Service Radar Map">
              <span id="h-acc-1">National Weather Service Radar Map</span>
            </a>
          </div>
        </div>
      </body>
      </html>
    `);

    const resolution = await SearchResultResolver.resolveSearchResult(page, {
      query: "National Weather Service Radar Map",
    });

    expect(resolution.status).toBe("resolved");
    expect(resolution.selectedCandidate?.url).toContain("/portal/resource/123");
    expect(resolution.selectedCandidate?.accessibleName).toContain("National Weather Service");
  });

  // 9. Result with a title and supporting snippet (Snippet disambiguation)
  it("9. Disambiguates two results with identical titles using snippet description", async () => {
    await page.setContent(`
      <!DOCTYPE html>
      <html>
      <body>
        <div id="results">
          <div class="result-card">
            <a href="/docs/billing" class="title">API Documentation</a>
            <p class="snippet">Invoicing, credit cards, payment webhooks, and billing cycles.</p>
          </div>
          <div class="result-card">
            <a href="/docs/browser" class="title">API Documentation</a>
            <p class="snippet">Browser automation, Playwright sessions, locator engine, and DOM observation.</p>
          </div>
        </div>
      </body>
      </html>
    `);

    const resolution = await SearchResultResolver.resolveSearchResult(page, {
      query: "browser automation api documentation",
    });

    expect(resolution.status).toBe("resolved");
    expect(resolution.selectedCandidate?.url).toContain("/docs/browser");
    expect(resolution.selectedCandidate?.scoreBreakdown.snippetMatch).toBeGreaterThan(0);
  });

  // 10. No relevant results
  it("10. Honestly reports no_match and fails closed with recoverable ELEMENT_NOT_FOUND when zero results match", async () => {
    await page.setContent(`
      <!DOCTYPE html>
      <html>
      <body>
        <div id="results">
          <p>No results found for your query.</p>
          <a href="/trending">Trending Categories</a>
        </div>
      </body>
      </html>
    `);

    const resolution = await SearchResultResolver.resolveSearchResult(page, {
      query: "Xylophone Quantum Supercomputing 998877",
    });

    expect(resolution.status).toBe("no_match");
    expect(resolution.diagnostics.selectionRationale).toContain("No matching search result found");

    const exec = await ActionExecutor.execute({
      action: {
        id: "step-click-result",
        type: ActionType.CLICK,
        target: { strategy: "css", value: "a:visible" },
        value: "Xylophone Quantum Supercomputing 998877",
        risk: RiskLevel.LOW,
        reason: "Select and open matching result for 'Xylophone Quantum Supercomputing 998877'",
      },
      page,
      tabId: "tab-test",
    });

    expect(exec.result.status).toBe(ActionStatus.FAILED);
    expect(exec.result.error?.code).toBe(ErrorCode.ELEMENT_NOT_FOUND);
    expect(exec.result.error?.recoverable).toBe(true);
  });

  // 11. Search page with several genuinely ambiguous candidates (Clean clarification request)
  it("11. Detects genuinely ambiguous candidates with identical relevance and returns structured clarification options", async () => {
    await page.setContent(`
      <!DOCTYPE html>
      <html>
      <body>
        <div id="results">
          <div class="result-card">
            <a href="/watch?v=season1_ep1" class="title">India's Got Latent - Episode 1 (Season 1)</a>
            <p class="snippet">Season 1 premiere episode of India's Got Latent</p>
          </div>
          <div class="result-card">
            <a href="/watch?v=season2_ep1" class="title">India's Got Latent - Episode 1 (Season 2)</a>
            <p class="snippet">Season 2 premiere episode of India's Got Latent</p>
          </div>
        </div>
      </body>
      </html>
    `);

    const resolution = await SearchResultResolver.resolveSearchResult(page, {
      query: "India's Got Latent Episode 1",
    });

    expect(resolution.status).toBe("ambiguous");
    expect(resolution.ambiguityReason).toContain("Multiple distinct results with similar relevance were found");
    expect(resolution.clarificationOptions).toHaveLength(2);
    expect(resolution.clarificationOptions![0].title).toContain("Episode 1");
  });

  // 12. Product search requiring price extraction and comparison
  it("12. Extracts prices from product cards and correctly ranks cheapest product", async () => {
    await page.setContent(`
      <!DOCTYPE html>
      <html>
      <body>
        <div class="product-grid">
          <div class="product-card" id="prod-1">
            <a href="/product/laptop-pro" class="title">UltraBook Pro 15</a>
            <span class="price">$1,299.00</span>
          </div>
          <div class="product-card" id="prod-2">
            <a href="/product/laptop-air" class="title">UltraBook Air 13</a>
            <span class="price">$799.00</span>
          </div>
          <div class="product-card" id="prod-3">
            <a href="/product/laptop-max" class="title">UltraBook Max 16</a>
            <span class="price">$1,899.00</span>
          </div>
        </div>
      </body>
      </html>
    `);

    const { candidates } = await SearchResultResolver.extractCandidates(page);
    expect(candidates.length).toBeGreaterThanOrEqual(3);

    const prices = candidates
      .filter((c) => c.metadata.price !== undefined)
      .map((c) => ({ title: c.title, price: c.metadata.price!, url: c.url }))
      .sort((a, b) => a.price - b.price);

    expect(prices[0].price).toBe(799.0);
    expect(prices[0].title).toContain("UltraBook Air 13");
  });

  // 13. Article search requiring navigation
  it("13. Selects and clicks article result, completing navigation postcondition", async () => {
    await page.setContent(`
      <!DOCTYPE html>
      <html>
      <body>
        <div id="results">
          <article class="article-card">
            <a href="#article-neural-networks" id="article-target" class="article-title">
              Artificial Neural Networks Fundamentals
            </a>
          </article>
        </div>
      </body>
      </html>
    `);

    let clicked = false;
    await page.exposeFunction("__onArticleClicked", () => {
      clicked = true;
    }).catch(() => {});

    await page.evaluate(() => {
      const a = document.getElementById("article-target");
      if (a) {
        a.addEventListener("click", (e) => {
          e.preventDefault();
          (window as any).__onArticleClicked();
          const h = document.createElement("h1");
          h.textContent = "Artificial Neural Networks Fundamentals";
          document.body.appendChild(h);
        });
      }
    });

    const exec = await ActionExecutor.execute({
      action: {
        id: "step-click-open-result",
        type: ActionType.CLICK,
        target: { strategy: "css", value: "a:has-text('Artificial Neural Networks')" },
        value: "Artificial Neural Networks Fundamentals",
        risk: RiskLevel.LOW,
        reason: "Open matching article result",
      },
      page,
      tabId: "tab-test",
    });

    expect(exec.result.status).toBe(ActionStatus.COMPLETED);
    expect(clicked).toBe(true);
  });

  // 14. Media search requiring playback verification
  it("14. TaskVerifier strictly confirms independent media playback evidence and rejects paused player", () => {
    const verifiedPlan = {
      id: "plan-media",
      taskInterpretation: "play song",
      actions: [
        { id: "step-1", type: ActionType.NAVIGATE, value: "https://www.youtube.com" },
        { id: "step-2", type: ActionType.FILL, value: "kya baat hai" },
        { id: "step-3", type: ActionType.CLICK, reason: "Select and open matching media result" },
        { id: "step-4", type: ActionType.MEDIA_PLAY, reason: "Start media playback" },
      ],
      successCriteria: ["Media active"],
    };

    // Unverified: media is paused
    const unverified = TaskVerifier.verifyTask({
      task: "play kya baat hai song on youtube",
      plan: verifiedPlan,
      targetUrl: "https://www.youtube.com",
      completedSteps: [
        { actionId: "step-1", type: ActionType.NAVIGATE, status: ActionStatus.COMPLETED, startTime: "", endTime: "", durationMs: 10, verified: true },
        { actionId: "step-2", type: ActionType.FILL, status: ActionStatus.COMPLETED, startTime: "", endTime: "", durationMs: 10, verified: true },
        { actionId: "step-3", type: ActionType.CLICK, status: ActionStatus.COMPLETED, startTime: "", endTime: "", durationMs: 10, verified: true },
        { actionId: "step-4", type: ActionType.MEDIA_PLAY, status: ActionStatus.COMPLETED, startTime: "", endTime: "", durationMs: 10, extractedData: { isPlaying: false, isPaused: true }, verified: false },
      ],
      extractedData: { isPlaying: false, isPaused: true },
      observation: null,
    });

    expect(unverified.passed).toBe(false);

    // Verified: media has established playback with currentTime > 0
    const verified = TaskVerifier.verifyTask({
      task: "play kya baat hai song on youtube",
      plan: verifiedPlan,
      targetUrl: "https://www.youtube.com",
      completedSteps: [
        { actionId: "step-1", type: ActionType.NAVIGATE, status: ActionStatus.COMPLETED, startTime: "", endTime: "", durationMs: 10, verified: true },
        { actionId: "step-2", type: ActionType.FILL, status: ActionStatus.COMPLETED, startTime: "", endTime: "", durationMs: 10, verified: true },
        { actionId: "step-3", type: ActionType.CLICK, status: ActionStatus.COMPLETED, startTime: "", endTime: "", durationMs: 10, verified: true },
        { actionId: "step-4", type: ActionType.MEDIA_PLAY, status: ActionStatus.COMPLETED, startTime: "", endTime: "", durationMs: 10, extractedData: { isPlaying: true, isPaused: false, currentTime: 2.5 }, verified: true },
      ],
      extractedData: { isPlaying: true, isPaused: false, currentTime: 2.5 },
      observation: {
        url: "https://www.youtube.com/watch?v=abc",
        title: "Kya Baat Hai",
        headings: ["Kya Baat Hai"],
        interactiveElements: [],
        forms: [],
        dialogs: [],
        summary: "Playing video",
        timestamp: new Date().toISOString(),
        tabId: "tab-1",
        mediaElements: [{ tagName: "video" as const, isPlaying: true, isPaused: false, currentTime: 2.5, readyState: 4, duration: 180, isMuted: false, volume: 1, ended: false }],
      },
    });

    expect(verified.passed).toBe(true);
  });

  // 15. Task with explicit constraints that prohibit a follow-up action
  it("15. PreExecutionValidator enforces negative constraints forbidding form submission or cart addition", async () => {
    const spec = EntityConstraintResolver.resolve({
      rawInstruction: "find contact for customer service but don't send message or submit form",
    });

    expect(spec.negations.some((n) => n.operation === "submit" && n.forbidden)).toBe(true);

    const submitAction = {
      id: "step-submit",
      type: ActionType.CLICK,
      target: { strategy: "css" as const, value: "button[type='submit']" },
      targetDescription: "Submit message button",
      risk: RiskLevel.LOW,
      reason: "Submit inquiry",
    };

    await expect(
      PreExecutionValidator.validate({
        action: submitAction,
        page,
        currentObservation: {
          url: "https://example.com/contact",
          title: "Contact",
          headings: ["Contact Us"],
          interactiveElements: [],
          forms: [],
          dialogs: [],
          summary: "Contact",
          timestamp: new Date().toISOString(),
          tabId: "tab-1",
        },
        authorizedTask: spec.originalInstruction,
      })
    ).rejects.toThrow("violates task negative constraint forbidding form submission");
  });

  // 16. Page with authentication or CAPTCHA barriers
  it("16. Halts safely as BLOCKED and reports AUTH_REQUIRED on sign-in or bot challenge without bypass", async () => {
    await page.setContent(`
      <!DOCTYPE html>
      <html>
      <body>
        <div role="alert" class="signin-interstitial">
          Sign in to confirm you are not a bot or to access this content.
        </div>
      </body>
      </html>
    `);

    const exec = await ActionExecutor.execute({
      action: {
        id: "step-play",
        type: ActionType.MEDIA_PLAY,
        target: { strategy: "css", value: "video" },
        risk: RiskLevel.LOW,
        reason: "Start media playback",
      },
      page,
      tabId: "tab-test",
    });

    expect(exec.result.status).toBe(ActionStatus.FAILED);
    expect(exec.result.error?.code).toBe(ErrorCode.AUTH_REQUIRED);
    expect(exec.result.error?.recoverable).toBe(false);
  });

  // 17. Task that must not repeat the same failed locator indefinitely
  it("17. RecoveryEngine prunes already-failed locators and avoids proposing identical failing targets", () => {
    const plan = {
      id: "plan-test",
      taskInterpretation: "click result",
      actions: [
        {
          id: "step-click",
          type: ActionType.CLICK,
          target: { strategy: "css" as const, value: "a.invalid-selector" },
          value: "Target Document",
          reason: "Click result",
        },
      ],
      successCriteria: ["Document opened"],
    };

    const observation: PageObservation = {
      url: "https://example.com/results",
      title: "Results",
      interactiveElements: [
        {
          id: "link-1",
          role: "link",
          tagName: "A",
          text: "Target Document",
          isVisible: true,
          isEnabled: true,
        },
      ],
      headings: [],
      forms: [],
      dialogs: [],
      summary: "Results",
      timestamp: new Date().toISOString(),
      tabId: "tab-1",
    };

    // If text:Target Document has already failed, it must not propose it again
    const failedTargets = new Set(["css:a.invalid-selector", "text:target document"]);

    const alternatives = RecoveryEngine.findAlternativeLocators(
      plan.actions[0].target,
      observation,
      RiskLevel.LOW,
      failedTargets,
      "Target Document"
    );

    expect(alternatives).toHaveLength(0);
  });

  // 18. Successful click that does not achieve requested task outcome
  it("18. TaskVerifier fails closed when a click succeeds but expected outcome is not verified", () => {
    const plan = {
      id: "plan-download",
      taskInterpretation: "download report",
      actions: [
        { id: "step-1", type: ActionType.NAVIGATE, value: "https://example.com/reports" },
        { id: "step-2", type: ActionType.CLICK, reason: "Click download button" },
      ],
      successCriteria: ["Report downloaded"],
    };

    // Click succeeded, but zero file downloads were captured
    const outcome = TaskVerifier.verifyTask({
      task: "download the annual financial report",
      plan,
      targetUrl: "https://example.com/reports",
      completedSteps: [
        { actionId: "step-1", type: ActionType.NAVIGATE, status: ActionStatus.COMPLETED, startTime: "", endTime: "", durationMs: 10, verified: true },
        { actionId: "step-2", type: ActionType.CLICK, status: ActionStatus.COMPLETED, startTime: "", endTime: "", durationMs: 10, verified: true },
      ],
      downloads: [], // No downloaded file
      observation: null,
    });

    expect(outcome.passed).toBe(false);
  });
});
