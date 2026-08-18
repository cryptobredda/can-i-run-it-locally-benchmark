import { describe, expect, it } from "vitest";
import { matchCatalogueModel } from "./model-match";

describe("matchCatalogueModel", () => {
  it.each([
    ["qwen3:8b-q4_K_M", "qwen3-8b"],
    ["Qwen/Qwen3-30B-A3B-Instruct", "qwen3-30b-a3b"],
    ["lmstudio-community/gemma-3-12b-it-GGUF", "gemma3-12b"],
    ["deepseek-r1:8b", "deepseek-r1-8b"],
    ["meta-llama/Llama-3.3-70B-Instruct", "llama-3-3-70b"]
  ])("maps %s", (modelId, slug) => {
    expect(matchCatalogueModel(modelId)?.slug).toBe(slug);
  });

  it("leaves unknown local models unmapped", () => {
    expect(matchCatalogueModel("my-lab/private-experiment")).toBeUndefined();
  });
});
