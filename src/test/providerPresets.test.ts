import { describe, test, expect } from "vitest";
import { PROVIDER_NATIVE_DEFAULTS, PROVIDER_MODEL_PRESETS, PROVIDER_LABELS } from "@/lib/ai/providerPresets";

describe("PROVIDER_NATIVE_DEFAULTS", () => {
  test("glm has no baseUrl", () => {
    expect(PROVIDER_NATIVE_DEFAULTS["glm"]).toBeUndefined();
  });
  test("opencode has no baseUrl", () => {
    expect(PROVIDER_NATIVE_DEFAULTS["opencode"]).toBeUndefined();
  });
  test("deepseek chatEndpoint includes /v1/", () => {
    expect(PROVIDER_NATIVE_DEFAULTS["deepseek"]?.chatEndpoint).toContain("/v1/");
  });
  test("known providers have required fields", () => {
    for (const [name, d] of Object.entries(PROVIDER_NATIVE_DEFAULTS)) {
      expect(d.baseUrl).toBeTruthy();
      expect(d.chatEndpoint).toBeTruthy();
      expect(d.apiStyle).toBeTruthy();
      expect(d.authHeaderName).toBeTruthy();
    }
  });
});

describe("PROVIDER_MODEL_PRESETS", () => {
  test("presets match providers in PROVIDER_LABELS (where present)", () => {
    for (const [provider] of Object.entries(PROVIDER_MODEL_PRESETS)) {
      if (PROVIDER_LABELS[provider]) {
        expect(PROVIDER_LABELS[provider]).toBeTruthy();
      }
    }
  });
  test("opencode presets include deepseek and glm entries", () => {
    const ids = PROVIDER_MODEL_PRESETS["opencode"]?.map(p => p.id) || [];
    expect(ids).toContain("deepseek-v4-pro");
    expect(ids).toContain("glm-5.2");
  });
});

describe("PROVIDER_LABELS", () => {
  test("covers all providers from the defaults map", () => {
    for (const [provider] of Object.entries(PROVIDER_NATIVE_DEFAULTS)) {
      expect(PROVIDER_LABELS[provider]).toBeTruthy();
    }
  });
  test("covers openai_compatible", () => {
    expect(PROVIDER_LABELS["openai_compatible"]).toBeTruthy();
  });
});
