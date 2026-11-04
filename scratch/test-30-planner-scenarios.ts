import { Planner } from "@/lib/agent/planner";

interface ScenarioTest {
  id: string;
  category: string;
  instruction: string;
  targetUrl?: string;
  expectedOperation?: string;
  expectedUrlPattern?: RegExp | string;
  expectedConfidenceRange: [number, number];
  expectedActionTypes?: string[];
}

const SCENARIOS: ScenarioTest[] = [
  // Category 1: Direct Navigation
  {
    id: "T01",
    category: "Direct Navigation",
    instruction: "Go to https://news.ycombinator.com",
    expectedUrlPattern: /news\.ycombinator\.com/,
    expectedConfidenceRange: [0.8, 1.0],
    expectedActionTypes: ["navigate"],
  },
  {
    id: "T02",
    category: "Direct Navigation",
    instruction: "Navigate to https://developer.mozilla.org/en-US/",
    expectedUrlPattern: /developer\.mozilla\.org/,
    expectedConfidenceRange: [0.8, 1.0],
    expectedActionTypes: ["navigate"],
  },
  {
    id: "T03",
    category: "Direct Navigation",
    instruction: "Visit https://en.wikipedia.org/wiki/Computer_science and read the page",
    expectedUrlPattern: /en\.wikipedia\.org/,
    expectedConfidenceRange: [0.8, 1.0],
    expectedActionTypes: ["navigate"],
  },

  // Category 2: Website-Name Resolution
  {
    id: "T04",
    category: "Website-Name Resolution",
    instruction: "Open Amazon",
    expectedUrlPattern: /amazon\.com/,
    expectedConfidenceRange: [0.75, 1.0],
    expectedActionTypes: ["navigate"],
  },
  {
    id: "T05",
    category: "Website-Name Resolution",
    instruction: "Navigate to Flipkart",
    expectedUrlPattern: /flipkart\.com/,
    expectedConfidenceRange: [0.75, 1.0],
    expectedActionTypes: ["navigate"],
  },
  {
    id: "T06",
    category: "Website-Name Resolution",
    instruction: "Go to YouTube",
    expectedUrlPattern: /youtube\.com/,
    expectedConfidenceRange: [0.75, 1.0],
    expectedActionTypes: ["navigate"],
  },
  {
    id: "T07",
    category: "Website-Name Resolution",
    instruction: "Open Wikipedia",
    expectedUrlPattern: /wikipedia\.org/,
    expectedConfidenceRange: [0.75, 1.0],
    expectedActionTypes: ["navigate"],
  },

  // Category 3: Search and Information Extraction
  {
    id: "T08",
    category: "Search & Extraction",
    instruction: "Search for mechanical keyboards on Amazon",
    expectedUrlPattern: /amazon\.com/,
    expectedConfidenceRange: [0.8, 1.0],
    expectedActionTypes: ["navigate", "fill"],
  },
  {
    id: "T09",
    category: "Search & Extraction",
    instruction: "Find wireless earbuds on Flipkart and extract title and price",
    expectedUrlPattern: /flipkart\.com/,
    expectedConfidenceRange: [0.8, 1.0],
    expectedActionTypes: ["navigate", "fill"],
  },
  {
    id: "T10",
    category: "Search & Extraction",
    instruction: "Search for 'Quantum Computing' on Wikipedia and extract the first paragraph",
    expectedUrlPattern: /wikipedia\.org/,
    expectedConfidenceRange: [0.8, 1.0],
    expectedActionTypes: ["navigate", "fill"],
  },
  {
    id: "T11",
    category: "Search & Extraction",
    instruction: "Search for 'React tutorial' on YouTube and open the first video",
    expectedUrlPattern: /youtube\.com/,
    expectedConfidenceRange: [0.8, 1.0],
    expectedActionTypes: ["navigate", "fill", "click"],
  },

  // Category 4: Product Comparisons
  {
    id: "T12",
    category: "Product Comparison",
    instruction: "Compare the prices of iPhone 15 and Samsung S24",
    expectedConfidenceRange: [0.7, 0.95],
  },
  {
    id: "T13",
    category: "Product Comparison",
    instruction: "Find the cheapest laptop on Amazon",
    expectedUrlPattern: /amazon\.com/,
    expectedConfidenceRange: [0.8, 1.0],
    expectedActionTypes: ["navigate", "fill"],
  },
  {
    id: "T14",
    category: "Product Comparison",
    instruction: "Compare prices between Sony WH-1000XM5 and Bose QuietComfort 45",
    expectedConfidenceRange: [0.7, 0.95],
  },

  // Category 5: Multi-step Workflows
  {
    id: "T15",
    category: "Multi-Step Workflow",
    instruction: "Go to https://example.com and click the more info link",
    targetUrl: "https://example.com",
    expectedUrlPattern: /example\.com/,
    expectedConfidenceRange: [0.8, 1.0],
    expectedActionTypes: ["navigate", "click"],
  },
  {
    id: "T16",
    category: "Multi-Step Workflow",
    instruction: "Search for Python books on Amazon and open the second result",
    expectedUrlPattern: /amazon\.com/,
    expectedConfidenceRange: [0.8, 1.0],
    expectedActionTypes: ["navigate", "fill", "click"],
  },
  {
    id: "T17",
    category: "Multi-Step Workflow",
    instruction: "Search for laptops on Flipkart with price under 50000",
    expectedUrlPattern: /flipkart\.com/,
    expectedConfidenceRange: [0.8, 1.0],
    expectedActionTypes: ["navigate", "fill"],
  },

  // Category 6: Form Filling
  {
    id: "T18",
    category: "Form Filling",
    instruction: "Fill out the registration form with username 'alex' and email 'alex@example.com' and submit",
    expectedConfidenceRange: [0.7, 0.95],
    expectedActionTypes: ["fill", "click"],
  },
  {
    id: "T19",
    category: "Form Filling",
    instruction: "Fill the contact form but do not submit",
    expectedConfidenceRange: [0.65, 0.9],
    expectedActionTypes: ["fill"],
  },
  {
    id: "T20",
    category: "Form Filling",
    instruction: "Save contact details as draft without clicking submit",
    expectedConfidenceRange: [0.65, 0.9],
    expectedActionTypes: ["fill"],
  },

  // Category 7: Media Playback
  {
    id: "T21",
    category: "Media Playback",
    instruction: "Play lo-fi beats on YouTube",
    expectedUrlPattern: /youtube\.com/,
    expectedConfidenceRange: [0.8, 1.0],
    expectedActionTypes: ["navigate", "fill", "mediaPlay"],
  },
  {
    id: "T22",
    category: "Media Playback",
    instruction: "Play classical sonata audio file",
    expectedConfidenceRange: [0.7, 0.95],
    expectedActionTypes: ["mediaPlay"],
  },
  {
    id: "T23",
    category: "Media Playback",
    instruction: "Watch the latest SpaceX launch video on YouTube",
    expectedUrlPattern: /youtube\.com/,
    expectedConfidenceRange: [0.8, 1.0],
    expectedActionTypes: ["navigate", "fill"],
  },

  // Category 8: Local File Operations
  {
    id: "T24",
    category: "Local File Operations",
    instruction: "Play audio file Hey_Sinamika.wav from local storage",
    expectedConfidenceRange: [0.7, 0.95],
  },
  {
    id: "T25",
    category: "Local File Operations",
    instruction: "Open report.pdf from the approved directory",
    expectedConfidenceRange: [0.65, 0.95],
  },
  {
    id: "T26",
    category: "Local File Operations",
    instruction: "Find and play interview_recording.ogg locally",
    expectedConfidenceRange: [0.7, 0.95],
  },

  // Category 9: Ambiguous Instructions
  {
    id: "T27",
    category: "Ambiguous Instructions",
    instruction: "Search for that item",
    expectedConfidenceRange: [0.1, 0.45],
    expectedActionTypes: ["requestClarification", "finish"],
  },
  {
    id: "T28",
    category: "Ambiguous Instructions",
    instruction: "Open it",
    expectedConfidenceRange: [0.1, 0.45],
    expectedActionTypes: ["requestClarification", "finish"],
  },
  {
    id: "T29",
    category: "Ambiguous Instructions",
    instruction: "Buy something cheap",
    expectedConfidenceRange: [0.1, 0.45],
    expectedActionTypes: ["requestClarification", "finish"],
  },

  // Category 10: Unsupported Operations
  {
    id: "T30",
    category: "Unsupported Operations",
    instruction: "Format hard drive C: and delete all files",
    expectedConfidenceRange: [0.0, 0.1],
    expectedActionTypes: ["finish"],
  },
  {
    id: "T31",
    category: "Unsupported Operations",
    instruction: "Install Discord on Windows and start streaming",
    expectedConfidenceRange: [0.0, 0.1],
    expectedActionTypes: ["finish"],
  },
  {
    id: "T32",
    category: "Unsupported Operations",
    instruction: "Run a host operating system script to bypass security permissions",
    expectedConfidenceRange: [0.0, 0.1],
    expectedActionTypes: ["finish"],
  },
];

async function runScenarioAudit() {
  console.log("============================================================");
  console.log("     BROWSEIQ 32-SCENARIO DETERMINISTIC PLANNER AUDIT       ");
  console.log("============================================================\n");

  const planner = new Planner();
  let passedCount = 0;
  const failureReports: string[] = [];
  const confidenceDistribution: number[] = [];

  for (const sc of SCENARIOS) {
    const t0 = Date.now();
    try {
      const plan = await planner.plan({
        task: sc.instruction,
        targetUrl: sc.targetUrl,
      });

      const conf = plan.planningMetadata?.deterministicConfidenceScore ?? -1;
      confidenceDistribution.push(conf);

      // Verify Plan Source
      if (plan.planningMetadata?.planSource !== "deterministic") {
        throw new Error(`Expected planSource 'deterministic', got '${plan.planningMetadata?.planSource}'`);
      }

      // Verify Confidence Range
      const [minConf, maxConf] = sc.expectedConfidenceRange;
      if (conf < minConf || conf > maxConf) {
        throw new Error(`Confidence ${conf} out of expected range [${minConf}, ${maxConf}]`);
      }

      // Verify Target URL if expected
      if (sc.expectedUrlPattern) {
        const nav = plan.actions.find((a) => a.type === "navigate");
        const navUrl = String(nav?.value || "");
        const matches = typeof sc.expectedUrlPattern === "string" 
          ? navUrl.includes(sc.expectedUrlPattern)
          : sc.expectedUrlPattern.test(navUrl);
        if (!matches) {
          throw new Error(`Expected navigation to match ${sc.expectedUrlPattern}, got '${navUrl}'`);
        }
      }

      // Verify Expected Action Types if specified
      if (sc.expectedActionTypes) {
        const actualTypes = plan.actions.map((a) => a.type);
        for (const reqType of sc.expectedActionTypes) {
          if (!actualTypes.includes(reqType as any)) {
            throw new Error(`Plan missing expected action type '${reqType}'. Actual: [${actualTypes.join(", ")}]`);
          }
        }
      }

      // Verify Success Criteria exists
      if (!plan.successCriteria || plan.successCriteria.length === 0) {
        throw new Error("Plan is missing successCriteria");
      }

      passedCount++;
      console.log(`✓ [PASS] [${sc.id}] [${sc.category}] "${sc.instruction}"`);
      console.log(`       Confidence: ${conf} | Actions: ${plan.actions.length} | First: ${plan.actions[0]?.type}`);
    } catch (err: any) {
      console.error(`✗ [FAIL] [${sc.id}] [${sc.category}] "${sc.instruction}": ${err.message}`);
      failureReports.push(`[${sc.id}] ${sc.instruction}: ${err.message}`);
    }
  }

  console.log("\n============================================================");
  console.log("            DETERMINISTIC PLANNER AUDIT SUMMARY             ");
  console.log("============================================================\n");
  console.log(`Total Scenarios Tested: ${SCENARIOS.length}`);
  console.log(`Passed: ${passedCount} / ${SCENARIOS.length} (${Math.round((passedCount / SCENARIOS.length) * 100)}%)`);

  // Print confidence distribution stats
  const minC = Math.min(...confidenceDistribution);
  const maxC = Math.max(...confidenceDistribution);
  const avgC = Math.round((confidenceDistribution.reduce((a, b) => a + b, 0) / confidenceDistribution.length) * 100) / 100;
  const distinctScores = Array.from(new Set(confidenceDistribution)).sort();

  console.log(`\nConfidence Calibration Analysis:`);
  console.log(`- Minimum Confidence: ${minC}`);
  console.log(`- Maximum Confidence: ${maxC}`);
  console.log(`- Average Confidence: ${avgC}`);
  console.log(`- Distinct Confidence Values: [${distinctScores.join(", ")}]`);

  if (failureReports.length > 0) {
    console.log(`\nFailures (${failureReports.length}):`);
    failureReports.forEach((f) => console.log(`  - ${f}`));
    process.exit(1);
  }
}

runScenarioAudit().catch((err) => {
  console.error("Audit suite error:", err);
  process.exit(1);
});

