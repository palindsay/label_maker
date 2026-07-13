import { describe, expect, it, vi } from "vitest";
import {
  LlmError,
  buildVisionRequest,
  extractPeptideFromImage,
  parseExtractionContent,
} from "./client";

const IMG = "data:image/png;base64,AAAA";
const CFG = { baseUrl: "/v1", model: "test-vlm" };

describe("buildVisionRequest", () => {
  it("embeds the image and model in a chat-completions body", () => {
    const body = buildVisionRequest(IMG, CFG);
    expect(body.model).toBe("test-vlm");
    expect(body.response_format).toEqual({ type: "json_object" });

    const user = body.messages.find((m) => m.role === "user");
    const image = (user?.content as Array<{ type: string; image_url?: { url: string } }>).find(
      (part) => part.type === "image_url",
    );
    expect(image?.image_url?.url).toBe(IMG);
  });
});

describe("parseExtractionContent", () => {
  it("parses plain JSON", () => {
    expect(parseExtractionContent('{"peptideName":"BPC-157","vialMg":5,"lot":"A1"}')).toEqual({
      peptideName: "BPC-157",
      vialMg: 5,
      lot: "A1",
    });
  });

  it("tolerates markdown code fences", () => {
    const fenced = '```json\n{"peptideName":"TB-500","vialMg":10}\n```';
    expect(parseExtractionContent(fenced)).toEqual({ peptideName: "TB-500", vialMg: 10 });
  });

  it('coerces a milligram string like "5 mg" to a number', () => {
    expect(parseExtractionContent('{"vialMg":"5 mg"}')).toEqual({ vialMg: 5 });
  });

  it("returns an empty object for unparseable content", () => {
    expect(parseExtractionContent("sorry, I cannot read this")).toEqual({});
  });

  it("drops fields with the wrong type", () => {
    expect(parseExtractionContent('{"peptideName":123,"vialMg":"nope"}')).toEqual({});
  });
});

describe("extractPeptideFromImage", () => {
  it("POSTs to the chat-completions endpoint and returns parsed fields", async () => {
    const fetchFn = vi.fn(async () =>
      Response.json({
        choices: [{ message: { content: '{"peptideName":"TB-500","vialMg":5}' } }],
      }),
    );

    const result = await extractPeptideFromImage(IMG, CFG, fetchFn);

    expect(result).toEqual({ peptideName: "TB-500", vialMg: 5 });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/v1/chat/completions");
    expect(init.method).toBe("POST");
  });

  it("classifies a missing multimodal model as a 'no-vision' failure", async () => {
    const body = JSON.stringify({
      error: { message: "image input is not supported - hint: provide the mmproj" },
    });
    const fetchFn = vi.fn(async () => new Response(body, { status: 500 }));

    const error = await extractPeptideFromImage(IMG, CFG, fetchFn).catch((e) => e);
    expect(error).toBeInstanceOf(LlmError);
    expect(error.kind).toBe("no-vision");
    expect(error.message).toMatch(/vision/i);
  });

  it("classifies an unknown model id as a 'model-missing' failure", async () => {
    const body = JSON.stringify({ error: "no router for requested model", src: "llama-swap" });
    const fetchFn = vi.fn(async () => new Response(body, { status: 404 }));

    const error = await extractPeptideFromImage(IMG, CFG, fetchFn).catch((e) => e);
    expect(error).toBeInstanceOf(LlmError);
    expect(error.kind).toBe("model-missing");
  });

  it("classifies a network failure as 'unreachable'", async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });

    const error = await extractPeptideFromImage(IMG, CFG, fetchFn).catch((e) => e);
    expect(error).toBeInstanceOf(LlmError);
    expect(error.kind).toBe("unreachable");
  });

  it("classifies an unexpected response shape as 'bad-response'", async () => {
    const fetchFn = vi.fn(async () => Response.json({ nonsense: true }));

    const error = await extractPeptideFromImage(IMG, CFG, fetchFn).catch((e) => e);
    expect(error).toBeInstanceOf(LlmError);
    expect(error.kind).toBe("bad-response");
  });

  it("falls back to 'unknown' for other error statuses", async () => {
    const fetchFn = vi.fn(async () => new Response("teapot", { status: 418 }));

    const error = await extractPeptideFromImage(IMG, CFG, fetchFn).catch((e) => e);
    expect(error).toBeInstanceOf(LlmError);
    expect(error.kind).toBe("unknown");
    expect(error.message).toMatch(/418/);
  });
});
