import { describe, expect, it, vi } from "vitest";
import {
  LlmError,
  buildVisionRequest,
  extractPeptideFromImage,
  listModels,
  parseExtractionContent,
  pickVisionModel,
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

  it("asks for the manufacturer and covers Certificate of Analysis reports", () => {
    const body = buildVisionRequest(IMG, CFG);
    const texts: string[] = [];
    for (const m of body.messages) {
      if (typeof m.content === "string") {
        texts.push(m.content);
      } else {
        for (const part of m.content) if (part.type === "text") texts.push(part.text);
      }
    }
    const prompt = texts.join(" ").toLowerCase();
    expect(prompt).toContain("manufacturer");
    expect(prompt).toContain("certificate of analysis");
  });

  it("tells the model where to find the peptide amount on a CoA", () => {
    const body = buildVisionRequest(IMG, CFG);
    const prompt = body.messages
      .flatMap((m) =>
        typeof m.content === "string"
          ? [m.content]
          : m.content.filter((p) => p.type === "text").map((p) => (p as { text: string }).text),
      )
      .join(" ")
      .toLowerCase();
    // CoAs phrase the amount as content/quantity/label-claim, not "10mg".
    expect(prompt).toMatch(/content|quantity|label claim|per vial/);
  });
});

describe("buildVisionRequest — per-model thinking control", () => {
  const userText = (body: ReturnType<typeof buildVisionRequest>) => {
    const user = body.messages.find((m) => m.role === "user");
    const parts = (user?.content ?? []) as Array<{ type: string; text?: string }>;
    return parts
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join(" ");
  };

  it("disables Qwen reasoning (enable_thinking + /no_think) and caps tokens", () => {
    const body = buildVisionRequest(IMG, { baseUrl: "/v1", model: "qwen3.6-27b-mtp" });
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(body.max_tokens).toBeGreaterThan(0);
    expect(userText(body)).toContain("/no_think");
  });

  it("disables Gemma reasoning without the Qwen /no_think token", () => {
    const body = buildVisionRequest(IMG, { baseUrl: "/v1", model: "gemma-4-31b-qat" });
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(userText(body)).not.toContain("/no_think");
  });

  it("sends no template flags for an unknown model — just a token cap", () => {
    const body = buildVisionRequest(IMG, { baseUrl: "/v1", model: "llava-1.6-13b" });
    expect(body.chat_template_kwargs).toBeUndefined();
    expect(body.max_tokens).toBeGreaterThan(0);
    expect(userText(body)).not.toContain("/no_think");
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

  it("reads purity, appending % to a bare number", () => {
    expect(parseExtractionContent('{"peptideName":"BPC-157","purity":"99.2%"}')).toEqual({
      peptideName: "BPC-157",
      purity: "99.2%",
    });
    expect(parseExtractionContent('{"purity":98}')).toEqual({ purity: "98%" });
  });

  it("reads the manufacturer from a CoA extraction", () => {
    expect(
      parseExtractionContent(
        '{"peptideName":"Ipamorelin","vialMg":10,"manufacturer":"utherpeptide.com","lot":"IP10-0106","purity":"99.780%"}',
      ),
    ).toEqual({
      peptideName: "Ipamorelin",
      vialMg: 10,
      manufacturer: "utherpeptide.com",
      lot: "IP10-0106",
      purity: "99.780%",
    });
  });
});

describe("pickVisionModel", () => {
  const models = [{ id: "gemma-4-31b" }, { id: "qwen3.6-27b" }, { id: "llava-1.6-13b" }];

  it("returns undefined for an empty list", () => {
    expect(pickVisionModel([], "anything")).toBeUndefined();
  });

  it("honours a preferred id when the endpoint serves it", () => {
    expect(pickVisionModel(models, "qwen3.6-27b")).toBe("qwen3.6-27b");
  });

  it("ignores a preferred id the endpoint does not serve", () => {
    // preferred absent -> falls through to heuristic (gemma looks like vision)
    expect(pickVisionModel(models, "gpt-4o")).toBe("gemma-4-31b");
  });

  it("prefers a model the endpoint flags vision-capable over name heuristics", () => {
    // "gemma" matches the name heuristic, but the flag on the plain id wins.
    const ms = [{ id: "gemma-text-only" }, { id: "plain-27b", vision: true }];
    expect(pickVisionModel(ms)).toBe("plain-27b");
  });

  it("prefers a vision-looking model over the first when no flag is present", () => {
    expect(pickVisionModel([{ id: "text-7b" }, { id: "qwen2.5-vl-7b" }])).toBe("qwen2.5-vl-7b");
  });

  it("falls back to the first model when none look like vision", () => {
    expect(pickVisionModel([{ id: "mystery-a" }, { id: "mystery-b" }])).toBe("mystery-a");
  });
});

describe("listModels", () => {
  it("returns discovered ids, names, and vision capability from GET /models", async () => {
    const fetchFn = vi.fn(async () =>
      Response.json({
        data: [{ id: "a" }, { id: "b", name: "B", capabilities: { vision: true } }],
      }),
    );

    const models = await listModels(CFG, fetchFn);

    expect(models).toEqual([{ id: "a" }, { id: "b", name: "B", vision: true }]);
    const [url] = fetchFn.mock.calls[0] as unknown as [string];
    expect(url).toBe("/v1/models");
  });

  it("throws 'unreachable' on a network failure", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("down");
    });
    const error = await listModels(CFG, fetchFn).catch((e) => e);
    expect(error).toBeInstanceOf(LlmError);
    expect(error.kind).toBe("unreachable");
  });

  it("throws 'bad-response' on an unexpected shape", async () => {
    const fetchFn = vi.fn(async () => Response.json({ nope: true }));
    const error = await listModels(CFG, fetchFn).catch((e) => e);
    expect(error).toBeInstanceOf(LlmError);
    expect(error.kind).toBe("bad-response");
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

  it("discovers a model from /models when none is configured", async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
      if (String(url).endsWith("/models")) {
        return Response.json({ data: [{ id: "qwen2.5-vl-7b" }] });
      }
      return Response.json({ choices: [{ message: { content: '{"peptideName":"X"}' } }] });
    });

    const result = await extractPeptideFromImage(IMG, { baseUrl: "/v1", model: "" }, fetchFn);

    expect(result).toEqual({ peptideName: "X" });
    expect(String(fetchFn.mock.calls[0]?.[0])).toContain("/models");
    // the resolved id is sent in the chat request
    const chatInit = fetchFn.mock.calls[1]?.[1] as unknown as RequestInit;
    const chatBody = JSON.parse(chatInit.body as string);
    expect(chatBody.model).toBe("qwen2.5-vl-7b");
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
