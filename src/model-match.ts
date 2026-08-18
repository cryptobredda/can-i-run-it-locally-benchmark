const catalogueModels = [
  { slug: "qwen3-8b", name: "Qwen3 8B", patterns: [/qwen3.*8b/, /qwen.*3.*8b/] },
  { slug: "qwen3-30b-a3b", name: "Qwen3 30B A3B", patterns: [/qwen3.*30b/, /qwen.*30.*a3b/] },
  { slug: "gemma3-12b", name: "Gemma 3 12B", patterns: [/gemma3.*12b/, /gemma.*3.*12b/] },
  { slug: "deepseek-r1-8b", name: "DeepSeek R1 8B", patterns: [/deepseek.*r1.*8b/, /deepseek.*8b.*r1/] },
  { slug: "gpt-oss-20b", name: "gpt-oss 20B", patterns: [/gpt.*oss.*20b/] },
  { slug: "glm-4-7-flash", name: "GLM-4.7 Flash", patterns: [/glm.*4.*7.*flash/, /glm47.*flash/] },
  { slug: "llama-3-3-70b", name: "Llama 3.3 70B", patterns: [/llama.*3.*3.*70b/, /llama33.*70b/] },
  { slug: "phi-4-mini", name: "Phi-4 Mini", patterns: [/phi.*4.*mini/, /phi4mini/] }
];

function normalized(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function matchCatalogueModel(modelId: string) {
  const value = normalized(modelId);
  const compact = value.replace(/\s/g, "");
  return catalogueModels.find((model) => model.patterns.some((pattern) => pattern.test(value) || pattern.test(compact)));
}
