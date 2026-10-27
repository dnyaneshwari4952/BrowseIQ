import { getConfig } from "@/lib/config";
import { createLLMProvider } from "@/lib/ai/llm-provider";

console.log("Config loaded:", {
  provider: getConfig().LLM_PROVIDER,
  geminiKeyConfigured: Boolean(getConfig().GEMINI_API_KEY),
  geminiModel: getConfig().GEMINI_MODEL,
});

const provider = createLLMProvider();
console.log("Provider created:", provider.name);
