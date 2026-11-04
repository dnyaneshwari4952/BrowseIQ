import { getConfig } from "@/lib/config";
import { createLLMProvider } from "@/lib/ai/llm-provider";

const config = getConfig();
console.log("Config loaded:", {
  provider: config.LLM_PROVIDER,
  model: config.LLM_MODEL,
});

try {
  const provider = createLLMProvider();
  console.log("Provider created:", provider.name);
} catch (err: any) {
  console.log("Provider creation caught error (expected when no API key configured):", {
    code: err.code,
    message: err.message,
  });
}
