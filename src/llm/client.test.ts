import { describe, expect, it, vi } from "vitest";
import { buildVisionRequest, extractPeptideFromImage, parseExtractionContent } from "./client";

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

  it("throws when the server responds with an error status", async () => {
    const fetchFn = vi.fn(async () => new Response("boom", { status: 500 }));
    await expect(extractPeptideFromImage(IMG, CFG, fetchFn)).rejects.toThrow(/500/);
  });
});
