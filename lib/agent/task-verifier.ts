import { TaskSuccessCriteria } from "../types/plans";
import { Action, ActionExecutionResult, ActionType } from "../types/actions";
import { TaskVerificationResult } from "../types/results";
import { PageObservation } from "../types/browser";
import { SemanticOperationVerifier } from "./semantic-operation-verifier";

export interface TaskVerificationContext {
  taskDescription: string;
  targetUrl?: string;
  criteria?: TaskSuccessCriteria | null;
  completedSteps: ActionExecutionResult[];
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
    completedSteps: ActionExecutionResult[];
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

    const missingOutputsSet = new Set<string>();
    const failedChecksSet = new Set<string>();

    // 1. If no steps were completed at all, task cannot be successful
    if (!completedSteps || completedSteps.length === 0) {
      return {
        passed: false,
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
        reason: `Task stopped because action '${failedStep.type}' failed: ${failedStep.error?.message || "Unknown error"}`,
        missingOutputs: criteria?.requiredOutputs || [],
        failedChecks: ["allStepsPassed"],
      };
    }

    // 3. Evaluate criteria if explicitly defined
    if (criteria) {
      // Check required operations via centralized SemanticOperationVerifier (Requirements 1 & 2)
      for (const op of criteria.requiredOperations) {
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
      if (criteria.requiredOutputs && criteria.requiredOutputs.length > 0) {
        const hasVerifiedDownload = Boolean(ctx.downloads && ctx.downloads.length > 0 && ctx.downloads.some((d) => d.verified));
        if (!extractedData || typeof extractedData !== "object") {
          for (const o of criteria.requiredOutputs) {
            if ((o === "file" || o === "download" || o === "downloadedFile") && hasVerifiedDownload) {
              continue;
            }
            missingOutputsSet.add(o);
          }
        } else {
          const dataObj = extractedData as Record<string, unknown>;
          for (const outputKey of criteria.requiredOutputs) {
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
      for (const check of criteria.verificationChecks) {
        if (check === "resultsExist") {
          const hasResults =
            extractedData &&
            typeof extractedData === "object" &&
            (
              Boolean((extractedData as any).title) ||
              Boolean((extractedData as any).name) ||
              Boolean((extractedData as any).count) ||
              (typeof (extractedData as any).total === "number" && (extractedData as any).total > 0) ||
              (Array.isArray((extractedData as any).products) && (extractedData as any).products.length > 0) ||
              (Array.isArray((extractedData as any).results) && (extractedData as any).results.length > 0) ||
              (Array.isArray(extractedData) && extractedData.length > 0)
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
          });
          if (!hasSearch) failedChecksSet.add("searchSubmitted");
        }
        if (check === "downloadCompleted") {
          const hasVerifiedDownload = Boolean(ctx.downloads && ctx.downloads.length > 0 && ctx.downloads.some((d) => d.verified)) ||
            completedSteps.some((s) => s.type === "download" && (s.downloadPath || s.extractedData));
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
            failedChecksSet.add("submissionOmitted");
          }
        }
      }
    }

    // 4. Intent-specific semantic validation (Prevents False Success on generic/wrong pages)
    // Extract intended query target from quotes or keywords
    let query: string | null = null;
    const quotedMatch = taskDescription.match(/['"]([^'"]+)['"]/);
    if (quotedMatch) {
      query = quotedMatch[1].trim().toLowerCase();
    } else {
      const queryMatch = taskLower.match(/(?:query|search|find)(?:\s+for)?\s+([a-zA-Z0-9_\-]+)/i);
      if (queryMatch && !["the", "page", "website", "products", "a"].includes(queryMatch[1])) {
        query = queryMatch[1].trim().toLowerCase();
      }
    }

    if (query && query !== "website" && query !== "product") {
      const queryWasEntered = completedSteps.some(
        (s) => (s.type === "fill" || s.type === "type") && String((s as any).value || "").toLowerCase().includes(query!)
      );

      let dataHasQuery = false;
      if (extractedData) {
        const dataStr = JSON.stringify(extractedData).toLowerCase();
        dataHasQuery = dataStr.includes(query);
      }

      if (!queryWasEntered && !dataHasQuery) {
        const pageHasQuery = latestObservation?.summary?.toLowerCase().includes(query) ||
          latestObservation?.interactiveElements?.some((el) => el.text?.toLowerCase().includes(query) || el.name?.toLowerCase().includes(query));

        if (!pageHasQuery) {
          failedChecksSet.add(`queryResultsFor:${query}`);
          return {
            passed: false,
            reason: `The target page does not contain a search interface or results matching '${query}'.`,
            missingOutputs: criteria?.requiredOutputs || ["searchResults"],
            failedChecks: Array.from(failedChecksSet),
            details: { query, url: latestObservation?.url },
          };
        }
      }
    }

    // Case B: Task asked for price extraction
    if (taskLower.includes("price")) {
      const dataStr = JSON.stringify(extractedData || "").toLowerCase();
      const hasPrice = /([₹$€£]|rs\.?|price|\b\d+[,.]\d{2}\b)/i.test(dataStr);
      if (!hasPrice) {
        missingOutputsSet.add("price");
        failedChecksSet.add("priceIdentified");
      }
    }

    // Case C: Task asked for download
    if (taskLower.includes("download")) {
      const hasDownload =
        Boolean(ctx.downloads && ctx.downloads.length > 0 && ctx.downloads.some((d) => d.verified)) ||
        completedSteps.some((s) => s.type === "download" && (s.downloadPath || s.extractedData));
      if (!hasDownload) {
        missingOutputsSet.add("downloadedFile");
        failedChecksSet.add("downloadCompleted");
      }
    }

    // Case D: Task asked for form submission / negation (Requirement 6)
    const isNegatedSubmit =
      /(?:not|don't|without|no)\s+(?:click\s+)?submit/i.test(taskLower) ||
      taskLower.includes("save draft");

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
    } else if (taskLower.includes("submit") || taskLower.includes("fill")) {
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
      if (missingOutputs.length > 0) {
        reasons.push(`Missing required outputs: [${missingOutputs.join(", ")}]`);
      }
      if (failedChecks.length > 0) {
        reasons.push(`Unsatisfied completion checks: [${failedChecks.join(", ")}]`);
      }

      return {
        passed: false,
        reason: reasons.join(". "),
        missingOutputs,
        failedChecks,
        details: { task: taskDescription, extractedData },
      };
    }

    return {
      passed: true,
      reason: "Task completed and verified against all required criteria.",
      missingOutputs: [],
      failedChecks: [],
      details: { extractedData },
    };
  }
}
