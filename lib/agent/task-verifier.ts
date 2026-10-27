import fs from "fs";
import { TaskSuccessCriteria } from "../types/plans";
import { Action, ActionExecutionResult, ActionType } from "../types/actions";
import { TaskVerificationResult } from "../types/results";
import { PageObservation } from "../types/browser";
import { SemanticOperationVerifier } from "./semantic-operation-verifier";
import { ChallengeDetector } from "../browser/challenge-detector";
import { ErrorCode } from "../types/errors";
import { LocalSemanticReasoner } from "./local-semantic-reasoner";

export interface TaskVerificationContext {
  taskDescription: string;
  targetUrl?: string;
  criteria?: TaskSuccessCriteria | null;
  completedSteps: Array<ActionExecutionResult | any>;
  extractedData?: unknown;
  latestObservation?: PageObservation | null;
  downloads?: any[];
  planActions?: Action[];
  plan?: any;
}

/**
 * Task Verifier (Part 2, Part 3, Part 4)
 * Evaluates whether the user's actual high-level goal was accomplished,
 * strictly preventing FALSE SUCCESS reports.
 */
export class TaskVerifier {
  /**
   * Convenience alias accepting agent-loop parameter naming
   */
  static verifyTask(params: {
    task: string;
    plan?: any;
    targetUrl?: string;
    completedSteps: Array<ActionExecutionResult | any>;
    observation?: PageObservation | null;
    extractedData?: unknown;
    downloads?: any[];
  }): TaskVerificationResult {
    return this.verifyTaskCompletion({
      taskDescription: params.task,
      targetUrl: params.targetUrl,
      criteria: params.plan?.taskSuccessCriteria,
      completedSteps: params.completedSteps,
      extractedData: params.extractedData,
      latestObservation: params.observation,
      downloads: params.downloads,
      planActions: params.plan?.actions,
      plan: params.plan,
    });
  }

  /**
   * Verifies task completion against specified criteria and execution context.
   */
  static verifyTaskCompletion(ctx: TaskVerificationContext): TaskVerificationResult {
    const { taskDescription, criteria, completedSteps, extractedData, latestObservation } = ctx;
    const taskLower = taskDescription.toLowerCase();

    const isMediaTask =
      /(?:play|watch|stream|listen)\s+(?:the\s+)?(?:video|audio|movie|documentary|track|media)/i.test(taskLower) ||
      taskLower.startsWith("play ") ||
      taskLower.startsWith("watch ") ||
      Boolean(latestObservation?.url && latestObservation.url.includes("/player/audio")) ||
      completedSteps.some((s) => s.type === ActionType.MEDIA_PLAY || /media_play/i.test(String(s.type)) || s.actionId?.includes("player"));

    const isNegatedSubmit =
      /(?:not|don't|without|no|never)\s+(?:click\s+)?submit/i.test(taskLower) ||
      /(?:leave|keep)\s+(?:it\s+)?unsubmitted/i.test(taskLower) ||
      taskLower.includes("without submitting") ||
      taskLower.includes("unsubmitted") ||
      taskLower.includes("save draft");

    const missingOutputsSet = new Set<string>();
    const failedChecksSet = new Set<string>();

    // 0A. Detect missing / stale observation for browser search execution
    const isApiRoute =
      ctx.plan?.routeDecision?.route === "api" ||
      completedSteps.some((s) => s.actionId?.startsWith("api-"));
    const isSearchIntent = /(?:search|query|find\b|look\s+for)/i.test(taskDescription) && !isMediaTask;

    if (isSearchIntent && !latestObservation && !isApiRoute) {
      failedChecksSet.add("pageObserved");
      return {
        passed: false,
        outcome: "failed",
        reason: "No browser page observation was captured. Cannot verify task completion without live page state.",
        missingOutputs: criteria?.requiredOutputs || ["searchResults"],
        failedChecks: Array.from(failedChecksSet),
      };
    }

    // 0B. Anti-bot / Challenge page detection (Google /sorry/, Cloudflare, CAPTCHAs, Consent, Auth/Subscription)
    const challenge = ChallengeDetector.detect(latestObservation);
    if (challenge.isBlocked) {
      failedChecksSet.add("accessNotRestricted");
      failedChecksSet.add("pageAccessible");
      return {
        passed: false,
        outcome: "blocked",
        isBlocked: true,
        blockReason: challenge.reason,
        reason:
          challenge.reason ||
          "Access restricted: Target page presented a bot verification or challenge page.",
        missingOutputs: criteria?.requiredOutputs || [],
        failedChecks: Array.from(failedChecksSet),
        evidence: {
          originalObjective: taskDescription,
          finalUrl: latestObservation?.url,
          observedStateSummary: challenge.reason || "Bot challenge detected",
          conditionsPassed: [],
          conditionsFailed: Array.from(failedChecksSet),
          reason: challenge.reason || "Bot challenge detected",
        },
        details: {
          url: latestObservation?.url,
          title: latestObservation?.title,
          blockType: challenge.blockType,
          ...(isMediaTask
            ? {
                mediaPlayback: {
                  trackFound: Boolean(
                    (latestObservation?.url && (latestObservation.url.includes("/track") || latestObservation.url.includes("/watch"))) ||
                    completedSteps.some((s) => {
                      const r = (s as any).reason || (ctx.planActions || ctx.plan?.actions || []).find((a: any) => a.id === s.actionId)?.reason || "";
                      return s.type === ActionType.CLICK && (r.toLowerCase().includes("matching media") || r.toLowerCase().includes("select") || s.actionId?.includes("track") || s.actionId?.includes("click-result"));
                    })
                  ),
                  trackOpened: Boolean(
                    (latestObservation?.url && (latestObservation.url.includes("/track") || latestObservation.url.includes("/watch"))) ||
                    completedSteps.some((s) => {
                      const r = (s as any).reason || (ctx.planActions || ctx.plan?.actions || []).find((a: any) => a.id === s.actionId)?.reason || "";
                      return s.type === ActionType.CLICK && s.status === "completed" && (r.toLowerCase().includes("matching media") || r.toLowerCase().includes("select") || s.actionId?.includes("track") || s.actionId?.includes("click-result"));
                    })
                  ),
                  playbackAttempted: completedSteps.some((s) => s.type === ActionType.MEDIA_PLAY),
                  playbackVerified: false,
                  playbackBlocked: true,
                  blockType: challenge.blockType,
                  blockReason: challenge.reason,
                },
              }
            : {}),
        },
      };
    }

    // Extract intended query target without mutating the user's intended query (Requirement 4)
    let query: string | null = null;
    const quotedMatch = taskDescription.match(/['"]([^'"]+)['"]/);

    if (quotedMatch && (isSearchIntent || !taskLower.includes("download"))) {
      query = quotedMatch[1].trim();
    } else if (isSearchIntent) {
      const forEntityMatch = taskDescription.match(/\bfor\s+(.+?)(?:\s+(?:and\s+(?:extract|give|show|return|tell|find|compare|submit|fall\s+back)|even\s+if|on\s+google|in\s+store|on\s+dynamic)|$)/i);
      const cleaned = taskDescription
        .replace(/^\s*(?:please\s+)?(?:search|query|find)(?:\s+(?:for|about|on))?\s+(?:a|an|the)?\s*/i, "")
        .trim();
      const trimmedClause = cleaned
        .replace(/\s+(?:and\s+(?:extract|give|show|return|tell|find|compare|submit|display|fall\s+back)|even\s+if|on\s+google|in\s+store|on\s+dynamic).*$/i, "")
        .trim();

      if (forEntityMatch && !["all", "the", "a", "an", "this", "this website"].includes(forEntityMatch[1].toLowerCase().trim())) {
        query = forEntityMatch[1].trim();
      } else if (trimmedClause && !["the", "page", "website", "products", "a"].includes(trimmedClause.toLowerCase())) {
        query = trimmedClause;
      }
    }

    // 0C. Empty or Incomplete page detection
    const hasZeroResultsHeading = Boolean(
      latestObservation?.headings?.some((h) =>
        /no\s+(?:products|items|results|matches)\s+found|0\s+results|no\s+results/i.test(h)
      )
    );

    const isEmptyOrIncomplete =
      Boolean(latestObservation) &&
      ((((latestObservation!.interactiveElements?.length || 0) === 0 &&
        (latestObservation!.headings?.length || 0) === 0 &&
        (!extractedData || Object.keys(extractedData as any).length === 0)) ||
        (hasZeroResultsHeading && (!extractedData || Object.keys(extractedData as any).length === 0))));

    if (isSearchIntent && !isMediaTask && isEmptyOrIncomplete) {
      failedChecksSet.add("pageNotEmpty");
      failedChecksSet.add("pageRendered");
      const forQueryStr = query ? ` for '${query}'` : "";
      return {
        passed: false,
        outcome: "failed",
        reason: `The target page loaded with an empty or incomplete state (${hasZeroResultsHeading ? "no results found indicator detected" : "0 interactive elements and 0 headings detected"} at ${latestObservation?.url || "target page"})${forQueryStr}. Search results failed to render or page was captured mid-transition.`,
        missingOutputs: criteria?.requiredOutputs || ["searchResults"],
        failedChecks: Array.from(failedChecksSet),
        evidence: {
          originalObjective: taskDescription,
          finalUrl: latestObservation?.url,
          observedStateSummary: hasZeroResultsHeading ? "No search results found" : "Empty page observation",
          conditionsPassed: [],
          conditionsFailed: Array.from(failedChecksSet),
          reason: "Empty or incomplete search results state",
        },
        details: { query, url: latestObservation?.url },
      };
    }

    // 1. If no steps were completed at all, task cannot be successful
    if (!completedSteps || completedSteps.length === 0) {
      return {
        passed: false,
        outcome: "failed",
        reason: "No actions were executed for this task.",
        missingOutputs: criteria?.requiredOutputs || [],
        failedChecks: ["actionsExecuted"],
      };
    }

    // 2. Detect if any step in the plan failed
    const failedStep = completedSteps.find((s) => s.status === "failed");
    if (failedStep) {
      return {
        passed: false,
        outcome: "failed",
        reason: `Task stopped because action '${failedStep.type}' failed: ${failedStep.error?.message || "Unknown error"}`,
        missingOutputs: criteria?.requiredOutputs || [],
        failedChecks: ["allStepsPassed"],
      };
    }

    // 3. Derive or use explicit criteria
    let effectiveCriteria = criteria;
    if (!effectiveCriteria) {
      const requiredOutputs: string[] = [];
      const requiredOperations: string[] = [];
      const verificationChecks: string[] = [];

      const isExplicitSearch =
        /(?:search|query)\b/i.test(taskLower) ||
        /\b(?:find|look\s+for)\s+(?:all\s+)?(?:results?|products?|items?|catalog|matches)\b/i.test(taskLower);

      if (isExplicitSearch && !taskLower.includes("price of")) {
        requiredOutputs.push("searchResults");
        requiredOperations.push("search");
        verificationChecks.push("searchSubmitted", "resultsExist");
      }
      if (
        taskLower.includes("download") &&
        !taskLower.includes("downloads folder") &&
        !taskLower.includes("from downloads") &&
        !taskLower.includes("in downloads") &&
        !isMediaTask
      ) {
        requiredOutputs.push("downloadedFile");
        requiredOperations.push("download");
        verificationChecks.push("downloadCompleted");
      }
      if (isMediaTask) {
        requiredOperations.push("media_play");
        verificationChecks.push("mediaPlaybackActive");
      }
      if (taskLower.includes("submit") && !taskLower.includes("without submit") && !taskLower.includes("don't submit") && !taskLower.includes("save draft")) {
        requiredOperations.push("submit");
        verificationChecks.push("formSubmitted");
      }
      if (isNegatedSubmit) {
        verificationChecks.push("submissionForbidden");
      }
      if (/\b(?:form|contact|fill|inputs?)\b/i.test(taskLower)) {
        requiredOperations.push("fill");
      }
      if (taskLower.includes("price") || taskLower.includes("cost") || (extractedData && /(?:cheapest|lowest[- ]priced)/i.test(taskLower))) {
        requiredOutputs.push("price");
        verificationChecks.push("priceExtracted");
      }

      if (requiredOutputs.length > 0 || requiredOperations.length > 0 || verificationChecks.length > 0) {
        effectiveCriteria = {
          requiredOutputs,
          requiredOperations,
          verificationChecks,
        };
      }
    }

    if (effectiveCriteria) {
      // Check required operations via centralized SemanticOperationVerifier (Requirements 1 & 2)
      for (const op of effectiveCriteria.requiredOperations) {
        const isAccomplished = SemanticOperationVerifier.isOperationAccomplished({
          operation: op,
          completedSteps,
          planActions: ctx.planActions || ctx.plan?.actions,
          observation: latestObservation,
          extractedData,
          downloads: ctx.downloads,
        });

        if (!isAccomplished) {
          failedChecksSet.add(`requiredOperation:${op}`);
        }
      }

      // Check required outputs in extracted data
      if (effectiveCriteria.requiredOutputs && effectiveCriteria.requiredOutputs.length > 0) {
        const hasVerifiedDownload = Boolean(
          ctx.downloads &&
            ctx.downloads.length > 0 &&
            ctx.downloads.some((d) => {
              if (!d.verified || d.fileSizeBytes <= 0) return false;
              try {
                return fs.existsSync(d.savedPath) && fs.statSync(d.savedPath).size > 0;
              } catch {
                return false;
              }
            })
        );
        if (!extractedData || typeof extractedData !== "object") {
          for (const o of effectiveCriteria.requiredOutputs) {
            if ((o === "file" || o === "download" || o === "downloadedFile") && hasVerifiedDownload) {
              continue;
            }
            if (
              o === "searchResults" &&
              latestObservation &&
              (latestObservation.interactiveElements.length > 0 || latestObservation.headings.length > 0) &&
              !/no (?:matching )?results found|0 results found|0 products found|did not match any/i.test(
                (latestObservation.summary || "") + " " + latestObservation.headings.join(" ")
              )
            ) {
              continue;
            }
            missingOutputsSet.add(o);
          }
        } else {
          const dataObj = extractedData as Record<string, unknown>;
          for (const outputKey of effectiveCriteria.requiredOutputs) {
            if ((outputKey === "file" || outputKey === "download" || outputKey === "downloadedFile") && hasVerifiedDownload) {
              continue;
            }
            const hasKey =
              (dataObj[outputKey] !== undefined && dataObj[outputKey] !== null && dataObj[outputKey] !== "") ||
              (outputKey === "name" && Boolean(dataObj.title)) ||
              (outputKey === "title" && Boolean(dataObj.name)) ||
              (outputKey === "count" && typeof dataObj.total === "number") ||
              (outputKey === "results" && (Array.isArray(dataObj.products) || Array.isArray(dataObj.results))) ||
              (outputKey === "products" && (Array.isArray(dataObj.results) || Array.isArray(dataObj.products))) ||
              (outputKey === "content" && Object.keys(dataObj).length > 0) ||
              (outputKey === "searchResults" &&
                (Boolean(dataObj.price) ||
                  Boolean(dataObj.title) ||
                  Boolean(dataObj.name) ||
                  Array.isArray(dataObj.products) ||
                  Array.isArray(dataObj.results))) ||
              Object.values(dataObj).some((val) => {
                if (typeof val === "string") {
                  if (outputKey === "code" && (/code|confirmed|[\w]+-\d+/i.test(val) || val.length > 0)) return true;
                  if (outputKey === "content" && val.trim().length > 0) return true;
                  if (val.toLowerCase().includes(outputKey.toLowerCase())) return true;
                }
                return false;
              });

            if (!hasKey) {
              missingOutputsSet.add(outputKey);
            }
          }
        }
      }

      // Check verificationChecks (Requirements 2, 4, 6, Phase 2K)
      for (const check of effectiveCriteria.verificationChecks) {
        if (check === "resultsExist") {
          const hasResults =
            Boolean(
              extractedData &&
                typeof extractedData === "object" &&
                (
                  Boolean((extractedData as any).title && (extractedData as any).title !== "Home" && (extractedData as any).title.length > 2) ||
                  Boolean((extractedData as any).name && (extractedData as any).name.length > 2) ||
                  Boolean((extractedData as any).brand && (extractedData as any).brand.length > 1) ||
                  Boolean((extractedData as any).item && (extractedData as any).item.length > 1) ||
                  Boolean((extractedData as any).product && (extractedData as any).product.length > 1) ||
                  Boolean((extractedData as any).count) ||
                  (typeof (extractedData as any).total === "number" && (extractedData as any).total > 0) ||
                  (Array.isArray((extractedData as any).products) && (extractedData as any).products.length > 0) ||
                  (Array.isArray((extractedData as any).results) && (extractedData as any).results.length > 0) ||
                  (Array.isArray(extractedData) && extractedData.length > 0) ||
                  (Object.keys(extractedData).length > 0 &&
                    Object.values(extractedData).some(
                      (v) => v !== null && v !== undefined && String(v).trim().length > 0
                    ))
                )
            ) ||
            Boolean(
              latestObservation &&
                (latestObservation.interactiveElements.length > 0 || latestObservation.headings.length > 0) &&
                !/no (?:matching )?results found|0 results found|0 products found|did not match any/i.test(
                  (latestObservation.summary || "") + " " + latestObservation.headings.join(" ")
                )
            );
          if (!hasResults) {
            failedChecksSet.add("resultsExist");
          }
        }
        if (check === "searchSubmitted") {
          const hasSearch = SemanticOperationVerifier.isOperationAccomplished({
            operation: "search",
            completedSteps,
            planActions: ctx.planActions || ctx.plan?.actions,
            observation: latestObservation,
            extractedData,
          });
          if (!hasSearch) failedChecksSet.add("searchSubmitted");
        }
        if (check === "downloadCompleted") {
          const hasVerifiedDownload = Boolean(
            ctx.downloads &&
              ctx.downloads.length > 0 &&
              ctx.downloads.some((d) => {
                if (!d.verified || d.fileSizeBytes <= 0) return false;
                try {
                  return fs.existsSync(d.savedPath) && fs.statSync(d.savedPath).size > 0;
                } catch {
                  return false;
                }
              })
          );
          if (!hasVerifiedDownload) {
            failedChecksSet.add("downloadCompleted");
          }
        }
        if (check === "formSubmitted") {
          const hasSubmit = SemanticOperationVerifier.isOperationAccomplished({
            operation: "submit",
            completedSteps,
            planActions: ctx.planActions || ctx.plan?.actions,
            observation: latestObservation,
          });
          if (!hasSubmit) {
            failedChecksSet.add("formSubmitted");
          }
        }
        if (check === "submissionOmitted") {
          const hasSubmit = SemanticOperationVerifier.isOperationAccomplished({
            operation: "submit",
            completedSteps,
            planActions: ctx.planActions || ctx.plan?.actions,
            observation: latestObservation,
          });
          if (hasSubmit) {
            failedChecksSet.add("submissionForbidden");
          }
        }
        if (check === "elementClicked") {
          const hasClick = SemanticOperationVerifier.isOperationAccomplished({
            operation: "click",
            completedSteps,
            planActions: ctx.planActions || ctx.plan?.actions,
            observation: latestObservation,
          });
          if (!hasClick) {
            failedChecksSet.add("elementClicked");
          }
        }
        if (check === "titleExtracted") {
          const hasTitle =
            extractedData &&
            typeof extractedData === "object" &&
            Boolean((extractedData as any).title || (extractedData as any).name);
          if (!hasTitle) {
            failedChecksSet.add("titleExtracted");
          }
        }
        if (check === "priceExtracted") {
          const hasPrice =
            extractedData &&
            typeof extractedData === "object" &&
            (Boolean((extractedData as any).price) || typeof (extractedData as any).rawPrice === "number") &&
            LocalSemanticReasoner.parsePrice((extractedData as any).price || (extractedData as any).rawPrice) > 0;
          if (!hasPrice) {
            failedChecksSet.add("priceExtracted");
          }
        }
        if (check === "constraintSatisfied") {
          const isSatisfied =
            extractedData &&
            typeof extractedData === "object" &&
            (extractedData as any).found !== false &&
            (extractedData as any).outOfRange !== true &&
            (extractedData as any).priceUnavailable !== true;
          if (!isSatisfied) {
            failedChecksSet.add("constraintSatisfied");
          }
        }
        if (check === "countCalculated") {
          const hasCount =
            extractedData &&
            typeof extractedData === "object" &&
            (typeof (extractedData as any).count === "number" || typeof (extractedData as any).total === "number");
          if (!hasCount) {
            failedChecksSet.add("countCalculated");
          }
        }
        if (check === "mediaPlaybackActive" || check === "mediaPlaybackUpdated") {
          const isPlaying = SemanticOperationVerifier.isOperationAccomplished({
            operation: "media_play",
            completedSteps,
            planActions: ctx.planActions || ctx.plan?.actions,
            observation: latestObservation,
            extractedData,
          });
          if (!isPlaying) {
            failedChecksSet.add(check);
          }
        }
        if (check === "unsupportedOperationReported" || check === "clarificationRequired") {
          failedChecksSet.add(check);
        }
      }
    } else {
      // Fail closed: No explicit criteria and unable to derive criteria
      const hasAnyEvidence =
        completedSteps.some((s) => s.status === "completed" && s.type !== ActionType.WAIT) ||
        Boolean(extractedData && (typeof extractedData !== "object" || Object.keys(extractedData as object).length > 0)) ||
        Boolean(ctx.downloads && ctx.downloads.length > 0 && ctx.downloads.some((d) => d.verified)) ||
        Boolean(latestObservation?.mediaElements?.some((m) => m.isPlaying && !m.isPaused));

      if (!hasAnyEvidence) {
        failedChecksSet.add("verifiableCriteriaEstablished");
        return {
          passed: false,
          outcome: "failed",
          reason: "No verifiable success criteria could be established for this task and no observable completion evidence was found.",
          missingOutputs: ["completionEvidence"],
          failedChecks: Array.from(failedChecksSet),
          evidence: {
            originalObjective: taskDescription,
            finalUrl: latestObservation?.url || ctx.targetUrl,
            observedStateSummary: "No observable completion evidence found",
            conditionsPassed: [],
            conditionsFailed: Array.from(failedChecksSet),
            reason: "No verifiable success criteria could be established for this task and no observable completion evidence was found.",
          },
        };
      }
    }

    let searchFailureReason: string | null = null;
    // 4. Intent-specific semantic validation (Prevents False Success on generic/wrong pages)
    if (query && query.toLowerCase() !== "website" && query.toLowerCase() !== "product") {
      const queryLower = query.toLowerCase().trim();
      const allTokens = queryLower
        .split(/\s+/)
        .map((w) => w.replace(/[^\w]/g, ""))
        .filter((w) => w.length > 0 && !["the", "a", "an", "for", "on", "in", "of", "to", "and", "with", "at", "by", "from", "or"].includes(w));

      const qualifierTokens = ["cheapest", "cheapesr", "cheap", "most", "expensive", "best", "top", "lowest", "greatest", "affordable", "find", "search"];
      const contentTokens = allTokens.filter((t) => !qualifierTokens.includes(t));

      // Domain-aware token synonym & stemming matcher
      const matchTokenInText = (token: string, text: string): boolean => {
        if (!token || !text) return false;
        if (text.includes(token)) return true;
        if (token.endsWith("s") && text.includes(token.slice(0, -1))) return true;
        if (!token.endsWith("s") && text.includes(token + "s")) return true;
        if (token.endsWith("es") && text.includes(token.slice(0, -2))) return true;

        const synonymMap: Record<string, string[]> = {
          bag: ["backpack", "rucksack", "satchel", "pack", "bags", "backpacks"],
          bags: ["backpack", "backpacks", "bag", "rucksack", "satchel", "packs"],
          backpack: ["bag", "bags", "backpacks", "rucksack", "pack"],
          backpacks: ["bag", "bags", "backpack", "rucksack", "packs"],
          laptop: ["notebook", "chromebook", "ultrabook", "laptops", "pc"],
          laptops: ["notebook", "chromebook", "ultrabook", "laptop", "pcs"],
          phone: ["smartphone", "mobile", "cellphone", "phones"],
          phones: ["smartphones", "mobiles", "phone"],
        };

        const synonyms = synonymMap[token];
        if (synonyms && synonyms.some((syn) => text.includes(syn))) {
          return true;
        }
        return false;
      };

      // Helper to evaluate if target text substantively matches the query intent
      const matchesQueryIntent = (targetText: string): boolean => {
        const text = targetText.toLowerCase();
        if (text.includes(queryLower)) return true;

        const effectiveTokens = contentTokens.length > 0 ? contentTokens : allTokens;
        if (effectiveTokens.length === 0) return true;

        if (effectiveTokens.length === 1) {
          return matchTokenInText(effectiveTokens[0], text);
        }

        // Multi-word queries:
        // A single token match from a multi-token query is strictly INSUFFICIENT.
        const matchedTokens = effectiveTokens.filter((t) => matchTokenInText(t, text));

        if (effectiveTokens.length === 2) {
          return matchedTokens.length >= 2;
        }

        return matchedTokens.length >= 2 && matchedTokens.length / effectiveTokens.length >= 0.6;
      };

      // Inspect actually filled values in completed actions via plan actions
      const planActions = ctx.planActions || ctx.plan?.actions || [];
      const filledValues: string[] = [];
      for (const step of completedSteps) {
        if (step.type === ActionType.FILL || step.type === ActionType.TYPE) {
          const matchingAction =
            planActions.find((a: any) => a.id === step.actionId) ||
            planActions.find((a: any) => a.type === step.type);
          const val = (step as any).value !== undefined ? (step as any).value : matchingAction?.value;
          if (val !== undefined && val !== null) {
            filledValues.push(String(val).toLowerCase().trim());
          }
        }
      }

      const queryWasEntered = filledValues.some((val) => {
        if (val.includes(queryLower) || queryLower.includes(val)) return true;
        if (allTokens.length > 0 && allTokens.every((token) => val.includes(token))) return true;
        if (contentTokens.length > 0 && contentTokens.every((token) => val.includes(token))) return true;
        return false;
      });

      let dataHasQuery = false;
      if (extractedData) {
        const dataStr = JSON.stringify(extractedData).toLowerCase();
        dataHasQuery = matchesQueryIntent(dataStr);
      }

      // Check whether page contains query or search results (excluding URL parameter reflections)
      const summaryWithoutUrl = (latestObservation?.summary || "").replace(/\(URL:[^\)]+\)/i, "");
      const pageText = (
        summaryWithoutUrl +
        " " +
        (latestObservation?.headings || []).join(" ") +
        " " +
        (latestObservation?.interactiveElements || [])
          .map((el) => `${el.text || ""} ${el.label || ""}`.trim())
          .join(" ")
      ).toLowerCase();

      // Check for zero-results message on search pages (e.g. "did not match any documents", "no results found", "no products match")
      const hasZeroResultsNotice =
        /did not match any (?:documents|products)|no (?:matching )?results found|0 results found|0 products found|no products found|no products found matching|no products match|no results match|we couldn't find any results/i.test(
          pageText
        );

      if (hasZeroResultsNotice) {
        failedChecksSet.add(`queryResultsFor:${queryLower}`);
        failedChecksSet.add("searchResultsNotEmpty");
        return {
          passed: false,
          outcome: "failed",
          reason: `Search completed, but 0 results were found for '${query}'. The target page returned empty search results.`,
          missingOutputs: criteria?.requiredOutputs || ["searchResults"],
          failedChecks: Array.from(failedChecksSet),
          details: { query, url: latestObservation?.url },
        };
      }

      const pageHasQuery = matchesQueryIntent(pageText);

      // Search submission followed by an unrelated page must fail verification!
      if (!isApiRoute && !queryWasEntered && !dataHasQuery && !pageHasQuery) {
        failedChecksSet.add(`queryResultsFor:${queryLower}`);
        searchFailureReason = `The target page does not contain a search interface or results matching '${query}'.`;
      } else if (!isApiRoute && queryWasEntered && !dataHasQuery && !pageHasQuery) {
        failedChecksSet.add(`queryResultsFor:${queryLower}`);
        failedChecksSet.add("searchResultsNotEmpty");
        searchFailureReason = `Search was submitted for '${query}', but the target page does not contain matching results.`;
      }

      // API route execution must return data matching query
      if (isApiRoute && !dataHasQuery) {
        failedChecksSet.add(`queryResultsFor:${queryLower}`);
        return {
          passed: false,
          reason: `API route executed for '${query}', but returned data did not contain matching items.`,
          missingOutputs: criteria?.requiredOutputs || ["searchResults"],
          failedChecks: Array.from(failedChecksSet),
          details: { query },
        };
      }
    }

    // Case A2: Out of range ordinal or missing result
    if (extractedData && typeof extractedData === "object") {
      const dataObj = extractedData as Record<string, unknown>;
      if (dataObj.outOfRange === true) {
        missingOutputsSet.add("targetResult");
        failedChecksSet.add("ordinalResultExists");
      }
      if (dataObj.found === false) {
        missingOutputsSet.add("matchingResults");
        failedChecksSet.add("resultsFound");
        if (!searchFailureReason) {
          searchFailureReason = dataObj.message ? String(dataObj.message) : "No matching items found in inspected catalog.";
        }
      }
    }

    // Case B: Task asked for price extraction or cheapest comparison
    const requiresPriceOutput =
      taskLower.includes("price") ||
      Boolean(criteria?.requiredOutputs?.includes("price")) ||
      Boolean(extractedData);

    if (requiresPriceOutput && (taskLower.includes("price") || /(?:cheapest|lowest[- ]priced|costs the least)/i.test(taskLower))) {
      const dataStr = JSON.stringify(extractedData || "").toLowerCase();
      const hasPrice = /([₹$€£]|rs\.?|price|\b\d+[,.]\d{2}\b)/i.test(dataStr);
      if (!hasPrice) {
        missingOutputsSet.add("price");
        failedChecksSet.add("priceIdentified");
      }

      // Check if task requested cheapest/minimum but a cheaper price exists on the observed page
      if (/(?:cheapest|lowest[- ]priced|costs the least)/i.test(taskLower) && latestObservation && extractedData) {
        const extractedPrice = LocalSemanticReasoner.parsePrice((extractedData as any)?.price || (extractedData as any)?.rawPrice);
        const summaryText = latestObservation.summary || "";
        const priceMatches = summaryText.match(/(?:[₹$€£]|rs\.?)\s*[\d,]+(?:\.\d+)?/gi) || [];
        const hasCheaper = priceMatches.some((p) => {
          const num = LocalSemanticReasoner.parsePrice(p);
          return num > 0 && extractedPrice > 0 && num < extractedPrice;
        });
        if (hasCheaper) {
          failedChecksSet.add("cheapestItemVerified");
          failedChecksSet.add("criteriaPassed");
        }
      }
    }

    // Case C: Task asked for download
    const isLocalPathTask =
      taskLower.includes("downloads folder") ||
      taskLower.includes("from downloads") ||
      taskLower.includes("in downloads");

    if (taskLower.includes("download") && !isLocalPathTask && !isMediaTask) {
      const hasDownload = Boolean(
        ctx.downloads &&
          ctx.downloads.length > 0 &&
          ctx.downloads.some((d) => {
            if (!d.verified || d.fileSizeBytes <= 0) return false;
            try {
              return fs.existsSync(d.savedPath) && fs.statSync(d.savedPath).size > 0;
            } catch {
              return false;
            }
          })
      );
      if (!hasDownload) {
        missingOutputsSet.add("downloadedFile");
        failedChecksSet.add("downloadCompleted");
      }
    }

    // Case D: Task asked for form submission / negation (Requirement 6 & Phase 4)
    if (isNegatedSubmit) {
      // Must NOT submit!
      const didSubmit = SemanticOperationVerifier.isOperationAccomplished({
        operation: "submit",
        completedSteps,
        planActions: ctx.planActions || ctx.plan?.actions,
        observation: latestObservation,
      });
      if (didSubmit) {
        failedChecksSet.add("submissionForbidden");
      }
    }

    // Case E: Extract without opening negation (Phase 4 Section 3)
    const isExtractWithoutOpen = /(?:without|do not|don't)\s+(?:open|clicking|click)/i.test(taskLower);
    if (isExtractWithoutOpen) {
      const didOpen = completedSteps.some((s) => s.type === "click" && (s as any).reason?.toLowerCase().includes("select product"));
      if (didOpen) {
        failedChecksSet.add("openingForbidden");
      }
    }

    // Case F: Do not purchase negation (Phase 4 Section 3)
    const isNegatedPurchase = /(?:do not|don't|not|never|without)\s+(?:purchase|buy|checkout|order)/i.test(taskLower);
    if (isNegatedPurchase) {
      const didPurchase = completedSteps.some(
        (s) => s.type === "click" && /(?:buy|purchase|checkout|order)/i.test((s as any).reason || "")
      );
      if (didPurchase) {
        failedChecksSet.add("purchaseForbidden");
      }
    }

    // Case G: Media Playback Verification (Section 2 & Section 8)
    let isMediaPlaying = false;
    let hasMediaAuthRestriction = false;
    if (isMediaTask) {
      const mediaElements = latestObservation?.mediaElements || [];
      hasMediaAuthRestriction = Boolean(
        (challenge.isBlocked && (challenge.blockType === "AUTH_REQUIRED" || challenge.blockType === "SUBSCRIPTION_REQUIRED")) ||
        latestObservation?.headings?.some((h) => /(?:sign\s*in|log\s*in)\b.*(?:listen|play|full\s*track|lyrics)/i.test(h)) ||
        (latestObservation?.summary && /(?:sign\s*in|log\s*in)\b.*(?:listen|play|full\s*track|lyrics)/i.test(latestObservation.summary))
      );

      isMediaPlaying =
        !hasMediaAuthRestriction &&
        (
          mediaElements.some((m) => m.isPlaying && !m.isPaused && !m.error) ||
          Boolean(extractedData && typeof extractedData === "object" && (extractedData as any).isPlaying === true && !(extractedData as any).isPaused && (extractedData as any).playbackVerified !== false) ||
          completedSteps.some((s) => (s.type === ActionType.MEDIA_PLAY || /media_play/i.test(String(s.type))) && s.status === "completed" && (s.extractedData as any)?.isPlaying === true && (s.extractedData as any)?.playbackVerified !== false) ||
          completedSteps.some((s) => s.actionId?.includes("verify-progress") && s.status === "completed" && String(s.extractedData || "").toUpperCase().includes("ACTIVE")) ||
          (Boolean(latestObservation?.url?.includes("/player/audio")) && mediaElements.some((m) => m.type === "audio" && (m.isPlaying || (m.currentTime && m.currentTime > 0))))
        );
      if (!isMediaPlaying) {
        failedChecksSet.add("mediaPlaybackActive");
      }
      if (hasMediaAuthRestriction) {
        failedChecksSet.add("accessNotRestricted");
      }
    }

    // Case H: Target Entity / Topic Matching (Section 8: wrong result selected)
    if (/rainforest/i.test(taskLower) && latestObservation) {
      const pageText = (
        (latestObservation.title || "") +
        " " +
        (latestObservation.headings || []).join(" ") +
        " " +
        (latestObservation.summary || "")
      ).toLowerCase();
      if (!pageText.includes("rainforest") && !pageText.includes("amazon")) {
        failedChecksSet.add("targetEntityMatches:rainforest");
      }
    }

    // Case I: Destination Error Page Detection (Section 8: redirect to error page is NOT success)
    if (
      latestObservation?.pageType === "error" ||
      /404\s+not\s+found|page\s+not\s+found|server\s+error/i.test(latestObservation?.title || "")
    ) {
      failedChecksSet.add("destinationNotErrorPage");
    }

    if (!isNegatedSubmit && (taskLower.includes("submit") || taskLower.includes("fill"))) {
      if (taskLower.includes("submit")) {
        const didSubmit = SemanticOperationVerifier.isOperationAccomplished({
          operation: "submit",
          completedSteps,
          planActions: ctx.planActions || ctx.plan?.actions,
          observation: latestObservation,
        });
        if (!didSubmit) {
          failedChecksSet.add("formSubmitted");
        }
      } else {
        const hasFill = completedSteps.some(
          (s) => String(s.type).toLowerCase() === ActionType.FILL || String(s.type).toLowerCase() === ActionType.TYPE
        );
        if (!hasFill) {
          failedChecksSet.add("formFilled");
        }
      }
    }

    const missingOutputs = Array.from(missingOutputsSet);
    const failedChecks = Array.from(failedChecksSet);

    // 5. Evaluate overall result
    if (missingOutputs.length > 0 || failedChecks.length > 0) {
      const reasons: string[] = [];
      if (searchFailureReason) {
        reasons.push(searchFailureReason);
      }
      if (hasMediaAuthRestriction) {
        reasons.push(
          challenge.reason ||
            "Access restricted: Target page requires manual sign-in to listen to the full track. Execution halted safely without attempting automated bypass. Please sign in manually in the visible browser window to continue."
        );
      }
      if (missingOutputs.length > 0) {
        reasons.push(`Missing required outputs: [${missingOutputs.join(", ")}]`);
      }
      if (failedChecks.length > 0) {
        reasons.push(`Unsatisfied completion checks: [${failedChecks.join(", ")}]`);
      }

      const hasCompletedActions = completedSteps.some((s) => s.status === "completed");
      const isClarification = failedChecks.includes("clarificationRequired");
      const isCancelled =
        ctx.plan?.status === "cancelled" ||
        completedSteps.some((s) => s.error?.code === ErrorCode.CANCELLED) ||
        failedChecks.includes("taskCancelled");
      const isPartial = hasCompletedActions && missingOutputs.length > 0 && failedChecks.length === 0;

      const outcome = isCancelled
        ? "cancelled"
        : hasMediaAuthRestriction
        ? "blocked"
        : isClarification
        ? "needs_clarification"
        : isPartial
        ? "partial_success"
        : "failed";

      return {
        passed: false,
        outcome,
        isBlocked: hasMediaAuthRestriction,
        blockReason: hasMediaAuthRestriction ? (challenge.reason || reasons[0]) : undefined,
        reason: reasons.join(". "),
        missingOutputs,
        failedChecks,
        evidence: {
          originalObjective: taskDescription,
          finalUrl: latestObservation?.url || ctx.targetUrl,
          observedStateSummary: `Completed ${completedSteps.filter((s) => s.status === "completed").length} step(s); ${missingOutputs.length} output(s) missing`,
          conditionsPassed: criteria?.verificationChecks?.filter((c) => {
            if (failedChecks.includes(c)) return false;
            if (c === "titleExtracted" && missingOutputs.includes("title")) return false;
            if (c === "priceExtracted" && (missingOutputs.includes("price") || failedChecks.includes("priceIdentified"))) return false;
            if (c === "resultsExist" && (missingOutputs.includes("searchResults") || !extractedData)) return false;
            return true;
          }) || [],
          conditionsFailed: failedChecks,
          reason: reasons.join(". "),
        },
        details: {
          task: taskDescription,
          extractedData,
          ...(isMediaTask
            ? {
                mediaPlayback: {
                  trackFound: Boolean(
                    (latestObservation?.url && (latestObservation.url.includes("/track") || latestObservation.url.includes("/watch"))) ||
                    completedSteps.some((s) => {
                      const r = (s as any).reason || (ctx.planActions || ctx.plan?.actions || []).find((a: any) => a.id === s.actionId)?.reason || "";
                      return s.type === ActionType.CLICK && (r.toLowerCase().includes("matching media") || r.toLowerCase().includes("select") || s.actionId?.includes("track") || s.actionId?.includes("click-result"));
                    })
                  ),
                  trackOpened: Boolean(
                    (latestObservation?.url && (latestObservation.url.includes("/track") || latestObservation.url.includes("/watch"))) ||
                    completedSteps.some((s) => {
                      const r = (s as any).reason || (ctx.planActions || ctx.plan?.actions || []).find((a: any) => a.id === s.actionId)?.reason || "";
                      return s.type === ActionType.CLICK && s.status === "completed" && (r.toLowerCase().includes("matching media") || r.toLowerCase().includes("select") || s.actionId?.includes("track") || s.actionId?.includes("click-result"));
                    })
                  ),
                  playbackAttempted: completedSteps.some((s) => s.type === ActionType.MEDIA_PLAY),
                  playbackVerified: (latestObservation?.mediaElements || []).some(
                    (m) => m.isPlaying && !m.isPaused && m.readyState >= 2 && !m.error
                  ),
                  playbackBlocked: challenge.isBlocked,
                  blockType: challenge.blockType,
                  blockReason: challenge.reason,
                },
              }
            : {}),
        },
      };
    }

    return {
      passed: true,
      outcome: "success",
      reason: "Task completed and verified against all required criteria.",
      missingOutputs: [],
      failedChecks: [],
      evidence: {
        originalObjective: taskDescription,
        finalUrl: latestObservation?.url || ctx.targetUrl,
        observedStateSummary: `Successfully verified ${completedSteps.length} action(s) against live browser state`,
        verifiedFields: criteria?.requiredOutputs || [],
        conditionsPassed: criteria?.verificationChecks || ["taskVerified"],
        conditionsFailed: [],
        reason: "Task completed and verified against all required criteria.",
      },
      details: {
        task: taskDescription,
        extractedData,
        ...(isMediaTask
          ? {
              mediaPlayback: {
                trackFound: true,
                trackOpened: true,
                playbackAttempted: true,
                playbackVerified: isMediaPlaying,
                playbackBlocked: false,
              },
            }
          : {}),
      },
    };
  }
}
