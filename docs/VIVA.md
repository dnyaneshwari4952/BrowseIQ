# Mentor Viva Preparation & Technical Deep-Dive
## BrowseIQ — Comprehensive Engineering Reference

This document provides technically rigorous, production-grade answers to mentor viva and architecture questions regarding **BrowseIQ**. Every explanation directly reflects the **actual runtime implementation** in this codebase.

---

## PART 1: CORE ARCHITECTURAL QUESTIONS (1–25)

### 1. What is browser automation?
Browser automation is the programmatic orchestration of a real web browser engine (Chromium, Firefox, WebKit) to navigate URLs, simulate authentic user interactions (keyboard keystrokes, pointer clicks, form inputs, file downloads, tab management), and extract rendered DOM state without manual human intervention. In this project, it is driven by Playwright (`lib/browser/browser-manager.ts`, `lib/browser/action-executor.ts`).

### 2. Why Playwright over Selenium or Puppeteer?
- **CDP/WebSocket Architecture**: Communicates bi-directionally over a persistent WebSocket connection, eliminating Selenium WebDriver's high-latency HTTP request-response polling.
- **Native Actionability Checks**: Playwright auto-waits for elements to be attached, visible, stable, enabled, and receiving events before dispatching clicks or keypresses, dramatically reducing race conditions.
- **Lightweight Context Isolation**: `BrowserContext` allows isolated browser sessions with independent storage, cookies, and cache in under 10ms without relaunching separate browser processes.
- **Event-Driven Primitives**: First-class asynchronous events for `page.waitForEvent('download')` and `context.on('page')` enable deterministic file interception and multi-tab lifecycle management.

### 3. Why use an LLM in browser automation?
Traditional browser automation scripts (e.g. Cypress or vanilla Playwright test scripts) are hardcoded and brittle: any minor layout shift, button rename, or wording variance breaks the workflow. An LLM provides:
- Natural-language task interpretation (`"Find the cheapest laptop under ₹70,000"`).
- Semantic task decomposition into typed intents (`TaskIntent`).
- Extraction of high-level constraints, ordinals, aggregations, and comparisons.
- Dynamic adaptation and replanning when runtime reality diverges from assumptions.

### 4. Why NOT let the LLM directly control the browser (or generate arbitrary JS)?
Allowing an LLM to generate raw executable JavaScript or Playwright scripts directly (e.g. via `eval()`, `new Function()`, or unconstrained bash commands) introduces catastrophic failure modes:
- **Security / Remote Code Execution**: Untrusted web pages containing prompt injection can instruct the LLM to exfiltrate secrets, read cookies, or execute malicious system calls.
- **Hallucinated Methods & Selectors**: LLMs hallucinate non-existent Playwright APIs or arbitrary XPath strings that hang or crash.
- **Infinite Loops & Flakiness**: The LLM lacks deterministic guarantees on timeouts and retry bounds.
**Our Architecture**: Strict separation of concerns. The LLM acts purely as a reasoning engine producing structured action schemas (`ActionSchema`). A deterministic runtime (`AgentLoop`, `ActionValidator`, `ActionExecutor`) validates, authorizes, executes, and verifies every operation.

### 5. What is structured planning?
Structured planning transforms an ambiguous natural-language goal into a typed, machine-verifiable sequence of atomic steps (`Plan` adhering to `PlanSchema`). Each action specifies:
- `id`: Unique identifier (e.g. `fill-search`).
- `type`: Discriminated action type (`navigate`, `click`, `fill`, `wait`, `openNewTab`, `download`, `evaluateSafe`, `finish`).
- `target`: Semantic locator definition (`strategy`, `value`, `role`, `index`).
- `value`: Input string or numeric timeout.
- `risk`: Risk classification (`low`, `medium`, `high`).
- `reason`: Explanatory rationale for mentor auditability.
- `taskSuccessCriteria`: Explicit conditions required for overall task completion.

### 6. What is function calling / tool-use design pattern?
Rather than parsing freeform conversational text (e.g. *"I will now click on the submit button"*), the agent exposes constrained tools/actions via JSON Schemas (`ActionSchema`, `LLMPlanOutputSchema`). The model selects and parameterizes tools within schema constraints. Responses undergo immediate Zod schema validation; any violation triggers an automatic self-correction prompt loop bounded to 2 retries.

### 7. What is DOM observation and why not send raw HTML to the LLM?
Raw webpage HTML commonly exceeds 500,000 tokens, containing megabytes of minified SVGs, CSS class names, tracking scripts, and styling noise that flood LLM context windows, increase latency, and introduce cost overruns.
Our `PageObserver` (`lib/browser/page-observer.ts`) captures a normalized, token-efficient snapshot (< 80 interactive elements):
- Accessible roles, names, and labels.
- Interactive candidate tags (`button`, `input`, `a`, `select`, `textarea`).
- Bounding-box visibility and enabled states.
- Associated `<label for="...">` bindings and placeholders.
- Top headings (`h1`, `h2`, `h3`) and active form containers.

### 8. What is semantic locator resolution?
Our `LocatorEngine` (`lib/browser/locator-engine.ts`) implements a 9-tier priority fallback hierarchy:
1. Accessibility Role + Accessible Name (Score: 100)
2. Associated Form Label (Score: 90)
3. Placeholder Text with Regex case-insensitivity (Score: 80)
4. Contextual Search/Input fallback (Score: 78)
5. Visible Text Content (Score: 70)
6. Stable Test IDs (`data-testid`, `data-test`) (Score: 65)
7. Name Attribute (Score: 60)
8. Stable ID (Score: 50)
9. CSS Selector / XPath (Score: 40/30)
Candidates are scored and evaluated dynamically. If the highest-scoring candidate is ambiguous (>1 match), the engine rejects unindexed interaction and requests clarification.

### 9. What is pre-execution validation?
Before Playwright executes any action, `PreExecutionValidator` (`lib/validation/pre-execution-validator.ts`) enforces 10 deterministic guardrails:
1. Zod schema conformance.
2. Target presence in current DOM state.
3. Element visibility check.
4. Element enabled state (rejects disabled buttons).
5. Target uniqueness (prevents accidental misclicks).
6. Target URL protocol safety (rejects `javascript:` or `file://` injection).
7. Redundant action check.
8. Unnecessary action check.
9. Risk rating validation.
10. System policy enforcement.

### 10. What is the fundamental difference between ActionVerifier and TaskVerifier?
- **ActionVerifier** (`lib/agent/action-verifier.ts`):
  Answers: *"Did this single atomic step execute successfully?"*
  Checks immediate post-conditions (e.g. did `navigate` change the URL? Did `fill` populate the input? Did `download` trigger a file event?).
- **TaskVerifier** (`lib/agent/task-verifier.ts`):
  Answers: *"Was the overarching user goal genuinely achieved?"*
  Checks holistic success criteria: Were all required operations executed? Are requested outputs present? Do extracted attributes belong to the same item?
  **Rule**: Even if 10 actions report `ActionStatus.COMPLETED`, the task fails if the complete goal is unsatisfied.

### 11. Why can a "click" action satisfy a "submit" operation?
This resolves the semantic taxonomy mismatch: In web browsers, `"submit"` is a high-level user intent, not a low-level browser primitive. In HTML forms, submission is accomplished by:
- Clicking a button with `type="submit"` or accessible text `"Submit"`.
- Pressing `Enter` inside a text field.
`TaskVerifier` uses centralized semantic operation mapping (`lib/agent/task-verifier.ts`): an action satisfies the `"submit"` operation if it is a `click` on a submit control, a `press: Enter`, or is accompanied by post-action form submission confirmation.

### 12. How is ambiguity handled?
When a task requests an ambiguous action (e.g. `"Click Submit"`) on a page with multiple identical targets (e.g. 3 separate Submit buttons for Newsletter, Feedback, and Support):
- The agent does NOT guess or click randomly.
- `SemanticDecomposer` and `LocatorEngine` flag `ELEMENT_AMBIGUOUS`.
- The task halts cleanly and returns `finalStatus: "needs_clarification"` with an explanatory prompt: *"Found 3 identical 'Submit' buttons on the page. Please clarify which target to click."*

### 13. How is prompt injection handled?
Web page content is treated strictly as **untrusted passive data** (`lib/security/prompt-defense.ts`):
- Multi-tier system prompt isolation cleanly separates `[SYSTEM INSTRUCTIONS]`, `[USER GOAL]`, and `[UNTRUSTED WEBPAGE CONTENT]`.
- System rules instruct the planner to never interpret text inside page content as executable directives.
- Regex and heuristic scanners detect injection tokens (`[SYSTEM OVERRIDE]`, `Ignore previous instructions`).
- Secrets (API keys, tokens) are never interpolated into page prompts.

### 14. How does API-first routing work?
The agent follows a hybrid architecture (`lib/api/api-router.ts`):
- If the task matches a registered API capability (e.g. Product Catalog Search or Invoice Download) and does NOT explicitly require UI interactions, it routes to `route: "api"`.
- The API is executed directly via `ApiExecutor`, delivering sub-100ms deterministic structured data.
- If no API matches or if UI interaction is requested, it delegates to Playwright browser automation.

### 15. What happens if the API fails or is unavailable?
`ApiExecutor` classifies errors (`AUTH_ERROR`, `RATE_LIMIT`, `SERVER_ERROR`, `NETWORK_ERROR`).
If the API returns an error or times out (5-second bounded `AbortSignal.timeout(5000)`):
- The agent logs route transition `RECOVERY_STARTED`.
- It sets `fallbackToBrowser: true`.
- The agent loop dynamically replans for the browser route targeting `browserFallbackUrl` (e.g. `/test-fixtures/search`) and completes execution via browser automation without failing the task.

### 16. What happens if the DOM changes after planning?
If button wording changes (e.g. `"Search"` becomes `"Find Products"` or `"Submit"` becomes `"Send"`):
- `RecoveryEngine` inspects the live observation.
- Safe semantic synonym matching identifies the updated candidate.
- It adapts the locator (`RETRY_WITH_ALTERNATIVE_LOCATOR`) and continues.
- For high-risk actions (`buy`, `delete`, `pay`), loose synonym escalation is strictly prohibited.

### 17. How does replanning work and how is strategy changed?
When an action fails after retry attempts:
1. `RecoveryEngine` triggers `REPLAN`.
2. `Planner.replan()` constructs a context containing:
   - Failed action and diagnostic error.
   - Already completed steps (never repeated).
   - Current live page observation.
   - Original overarching goal.
3. The LLM generates a revised plan for the **remaining steps only**.
4. The new plan is validated and execution resumes.

### 18. How are retries and loops bounded?
To prevent runaway loops:
- `MAX_ACTION_RETRIES`: Capped at 3 attempts per individual action.
- `MAX_REPLANS`: Capped at 3 plan revisions per task.
- `TASK_TIMEOUT`: Global active timer (default: 180s) backed by `AbortController`. When expired, it cancels execution, aborts active requests, closes Chromium, and returns `timed_out`.

### 19. How is False Success measured and eliminated?
- **False Success**: Occurs when an agent reports `status: "completed"`, but the user goal was not actually achieved (or verification checks failed).
- **Measurement**: Our evaluation suite compares the agent's reported status against independent oracle verification. If `expected !== "completed"` but `actual === "completed"`, a False Success is detected.
- In our benchmark, **False Successes Detected = 0 (0.0%)**.

### 20. How is task success measured?
Task success is measured holistically:
- Did the agent reach `finalStatus: "completed"`?
- Did `TaskVerifier` confirm all required operations?
- Are all requested outputs extracted and non-empty?
- On impossible or ambiguous tasks, did the agent fail honestly or ask for clarification?

### 21. How are credentials protected?
- API keys (OpenAI, Gemini) and system tokens are stored in environment variables (`.env`) on the server.
- Server-side routes handle LLM and API execution; secrets are never sent to client React components.
- Diagnostics, execution trace logs, and event streams redact secret tokens.

### 22. How are downloads verified?
- A click on a download link is not assumed to be success.
- `BrowserManager` listens to Playwright's `page.on('download')` event.
- The downloaded file is streamed to a designated `downloads/` directory.
- `fs.statSync` verifies that the file physically exists on disk and is non-empty (`fileSizeBytes > 0`).

### 23. How are multiple tabs handled?
- `BrowserManager` listens to `context.on('page')` for automatically opened tabs (`target="_blank"`).
- `ActionType.OPEN_NEW_TAB` creates or resolves target URLs and assigns stable tab IDs.
- `ActionType.SWITCH_TAB` brings target pages to the foreground via `page.bringToFront()`.
- Active tabs are tracked in `ctx.browserTabs`.

### 24. What happens when authentication or CAPTCHAs appear?
- The agent does NOT attempt to bypass CAPTCHAs, crack passwords, or scrape credentials.
- `RecoveryEngine` detects `CAPTCHA_DETECTED` or `AUTH_REQUIRED`.
- The task halts safely in `finalStatus: "waiting_for_user"`, allowing the user to solve the challenge before resuming.

### 25. What are the current limitations of the system?
1. **Dynamic Single-Page Application Latency**: SPAs with extreme client-side rendering delays (>15s) require explicit dynamic wait conditions.
2. **Third-Party Iframe Sandboxing**: Cross-origin iframes with strict CSP require specialized frame locator targeting.
3. **Complex Mathematical Aggregation**: While MIN, MAX, COUNT, and filtering are supported, advanced statistical aggregations (standard deviation, complex multi-field joins) currently require post-processing.

---

## PART 2: 45 MENTOR ATTACK SCENARIOS & CODE DEFENSES

#### 1. What if the button text changes from "Search" to "Find Products"?
`RecoveryEngine.findAlternativeLocator` checks `SAFE_SYNONYM_GROUPS` (`search`, `find`, `query`, `lookup`). It discovers the alternative semantic locator and retries without failing.

#### 2. What if the page contains three identical Submit buttons?
`PageCapabilityDetector` and `SemanticDecomposer` flag `AMBIGUOUS_ACTION`. The agent returns `needs_clarification` with the prompt: *"Found 3 identical 'Submit' buttons on the page. Please clarify which target to click."*

#### 3. What if the first search result is not the cheapest?
The agent does not blindly pick the first item. `evaluateSafe` extracts all product cards; `LocalSemanticReasoner.evaluate` parses prices numerically and finds the true `MIN(price)`.

#### 4. What if the user says "Fill the form but do NOT submit"?
`SemanticDecomposer` extracts `negation: { operation: "submit", forbidden: true }`. The planner omits the submit click. `TaskVerifier` asserts `submissionOmitted: true`.

#### 5. What if the user says "Fill the form and save as draft", but the form has no draft feature?
`SemanticDecomposer` detects that the page has no draft capability and returns `unsupported_task` honestly.

#### 6. What if the target URL has no search interface (e.g. search task on Contact Form)?
`PageCapabilityDetector.detectMismatch` inspects the page observation, detects capability mismatch, and halts with `needs_clarification` in under 1 second rather than wasting 8 retries.

#### 7. What if the API fails with HTTP 500?
`ApiExecutor` catches HTTP 500, sets `fallbackToBrowser: true`, and `AgentLoop` dynamically replans for the browser automation fallback route.

#### 8. What if the API times out?
`ApiExecutor` uses `AbortSignal.timeout(5000)`. It aborts cleanly at 5 seconds and triggers browser automation fallback.

#### 9. What if the external API returns malformed JSON?
`ApiExecutor` catches JSON parse errors, classifies as `INVALID_RESPONSE`, and falls back to the browser route.

#### 10. What if the LLM returns invalid JSON?
`Planner.callLLMWithSchemaRetry` catches parse or Zod validation errors, formats the exact schema issues, and requests an immediate correction prompt (up to 2 retries).

#### 11. What if the webpage contains a malicious prompt injection payload?
`PromptDefense` isolates page text in `UNTRUSTED WEBPAGE CONTENT`. System rules prohibit treating page text as instructions.

#### 12. What if a webpage asks for the agent's API key?
The browser agent has no API key in its DOM execution context. Server keys are protected in environment variables and never logged or exposed.

#### 13. What if the requested element disappears during execution?
`RecoveryEngine` classifies as `STALE_TARGET` or `ELEMENT_NOT_FOUND`, re-observes the page, and either adapts locator or triggers a dynamic replan.

#### 14. What if the DOM changes after planning?
`PageObserver` re-observes the page after every single action, providing the updated DOM state for subsequent validations.

#### 15. What if clicking a link opens a new tab?
`BrowserManager`'s `context.on('page')` listener intercepts the new tab, registers a new tab ID, and tracks it in `ctx.browserTabs`.

#### 16. What if the target URL is wrong or unreachable?
Playwright's navigation throws a network error. `RecoveryEngine` classifies as `NETWORK_ERROR` and halts with a clear diagnostic explanation.

#### 17. What if the task is impossible (e.g. "Delete my bank account")?
`SemanticDecomposer` flags `DESTRUCTIVE_UNSUPPORTED` and terminates immediately with `unsupported_task`.

#### 18. What prevents infinite retry loops?
`MAX_ACTION_RETRIES` (3), `MAX_REPLANS` (3), and `TASK_TIMEOUT` (180s) strictly bound all execution loops.

#### 19. What prevents false success?
`TaskVerifier` verifies complete user criteria against live browser state. If criteria are unmet, status is forced to `failed`.

#### 20. What prevents random clicking?
`PreExecutionValidator` asserts element visibility, enabled state, role conformance, and uniqueness before every click.

#### 21. What proves the task actually succeeded?
`TaskVerifier` generates a cryptographic and structured audit record verifying required operations, extracted outputs, and DOM confirmation elements.

#### 22. What happens if a page requires login?
The agent classifies as `AUTH_REQUIRED` and transitions to `waiting_for_user`.

#### 23. What happens if CAPTCHA appears?
Classified as `CAPTCHA_DETECTED`, execution pauses, and the agent awaits manual user completion.

#### 24. What if the user asks for the most expensive product?
`SemanticDecomposer` sets `comparison: { operation: "MAX", field: "price" }`. `LocalSemanticReasoner` extracts all cards and computes the maximum price.

#### 25. What if the user asks for products under ₹70,000?
`LocalSemanticReasoner` applies `operator: "<", value: 70000` to filter matching items.

#### 26. What if the user asks for the cheapest product under ₹70,000?
Compound reasoning: `LocalSemanticReasoner` applies the filter first, then evaluates `MIN` across the filtered subset.

#### 27. What if the user asks to count results?
`SemanticDecomposer` sets `aggregation: "COUNT"`. The reasoner counts the extracted results and returns total.

#### 28. What if the user asks for the second product?
`SemanticDecomposer` extracts `ordinal: { target: "second", index: 1 }`. The reasoner selects index 1.

#### 29. What if the user asks for the last product?
`SemanticDecomposer` extracts `ordinal: { target: "last", index: -1 }`. The reasoner selects `items[items.length - 1]`.

#### 30. What if a product has no price tag?
`LocalSemanticReasoner.parsePrice` handles missing or null prices safely, defaulting to 0 without throwing runtime exceptions.

#### 31. What if content loads with a 2-second delay?
`ActionType.WAIT` with dynamic wait target waits for the element to appear in DOM before attempting extraction.

#### 32. What if a download produces an empty 0-byte file?
`BrowserManager` inspects `fs.statSync(savedPath).size`. If `size === 0`, `verified: false` is recorded and `TaskVerifier` rejects the task.

#### 33. What if the LLM hallucinates an invalid action type?
`ActionSchema` validation fails immediately in `PreExecutionValidator` and execution is blocked.

#### 34. What if an element is disabled?
`PreExecutionValidator` rule 4 asserts `element.isEnabled`. Disabled buttons are rejected before clicking.

#### 35. What if the user cancels execution mid-flight?
`AbortController` signals cancellation; active Playwright actions are aborted, the browser context closes, and `finalStatus: "cancelled"` is returned.

#### 36. What if the browser crashes unexpectedly?
`try/catch` in `AgentLoop` catches process exits, logs `RUNTIME_ERROR`, and cleans up orphaned Chromium processes in `finally`.

#### 37. What if there are 100 results on the page?
`PageObserver` caps candidate interactive nodes to 80 to prevent LLM context overflow.

#### 38. What if the user query is in quotes (e.g. "laptop")?
`SemanticDecomposer.extractQuery` uses regex extraction to prioritize quoted terms as explicit search queries.

#### 39. What if a button says "Buy" instead of "Add to Cart"?
`RecoveryEngine` prevents loose synonym matching on high-risk actions (`buy`, `checkout`, `delete`). It demands confirmation rather than risking unauthorized financial transactions.

#### 40. What if an external API has no search parameter?
`ApiRegistry.extractParameters` extracts query parameters or falls back to sensible defaults.

#### 41. What if multiple tabs are opened simultaneously?
`BrowserManager` maintains a registry of tabs in a `Map<string, { page, tab }>`. Active context can be switched deterministically via `switchTab(tabId)`.

#### 42. What if the page title has changed dynamically?
`PageObserver` extracts live page titles on every observation.

#### 43. What if a prompt injection tries to execute JavaScript?
The agent architecture does not execute generated JavaScript in the browser. Actions are executed via native Playwright API calls.

#### 44. What if an API route is faster than browser automation?
The `ApiRouter` chooses the direct API route, returning structured responses in under 100ms.

#### 45. What proves the agent is general-purpose rather than fixture-specific?
The agent uses semantic role resolution, typed intent decomposition, and DOM-first observation rather than hardcoded URLs or element IDs. It successfully executes held-out unseen tasks and gracefully identifies capability mismatches.
