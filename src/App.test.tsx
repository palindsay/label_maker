import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { decodeQrFromDataUrl, exportLabelPng } from "./browser";
import { fetchCoaImage } from "./coa";
import { fileToDataUrl } from "./image";
import { extractPeptideFromImage, listModels } from "./llm/client";

// Mock only the file-reading side effect; keep the pure labelPngFilename real.
vi.mock("./image", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./image")>()),
  fileToDataUrl: vi.fn(async () => "data:image/png;base64,x"),
}));

// Browser-only glue (canvas / pdf.js) is unavailable in jsdom — stub it.
vi.mock("./browser", () => ({
  decodeQrFromDataUrl: vi.fn(async () => null),
  rasterizePdfToDataUrl: vi.fn(async () => "data:image/png;base64,PDF"),
  exportLabelPng: vi.fn(async () => "copied"),
}));
vi.mock("./coa", () => ({
  fetchCoaImage: vi.fn(async () => "data:image/png;base64,COA"),
}));

// Mock only the network-touching functions; keep pickVisionModel / config real.
vi.mock("./llm/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./llm/client")>();
  return {
    ...actual,
    listModels: vi.fn(async () => [{ id: "gemma-4-31b" }, { id: "qwen3.6-27b" }]),
    extractPeptideFromImage: vi.fn(async () => ({ peptideName: "TB-500", vialMg: 10 })),
  };
});

const DEFAULT_MODELS = [{ id: "gemma-4-31b" }, { id: "qwen3.6-27b" }];

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(extractPeptideFromImage).mockResolvedValue({ peptideName: "TB-500", vialMg: 10 });
  vi.mocked(listModels).mockResolvedValue(DEFAULT_MODELS);
  vi.mocked(decodeQrFromDataUrl).mockResolvedValue(null);
  vi.mocked(fetchCoaImage).mockResolvedValue("data:image/png;base64,COA");
  vi.mocked(exportLabelPng).mockResolvedValue("copied");
});

/** Render and wait for model discovery to settle. */
async function renderApp() {
  render(<App />);
  await screen.findByRole("option", { name: "gemma-4-31b" });
}

/** A manually-controlled promise, to hold an extraction "in flight". */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("App", () => {
  it("renders the default peptide label and prints on demand", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    await renderApp();

    expect(screen.getByRole("heading", { name: "Peptide Label Maker" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("BPC-157")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Print" }));
    expect(print).toHaveBeenCalledOnce();
  });

  it("copies the label image and confirms via a note", async () => {
    await renderApp();

    await userEvent.click(screen.getByRole("button", { name: "Copy image" }));

    expect(exportLabelPng).toHaveBeenCalledOnce();
    expect(vi.mocked(exportLabelPng).mock.calls[0]?.[1]).toBe("bpc-157-label.png");
    await waitFor(() =>
      expect(screen.getByText("Copied the label image to the clipboard.")).toBeInTheDocument(),
    );
  });

  it("explains the HTTPS fallback when the image is downloaded instead", async () => {
    vi.mocked(exportLabelPng).mockResolvedValueOnce("downloaded");
    await renderApp();

    await userEvent.click(screen.getByRole("button", { name: "Copy image" }));

    await waitFor(() =>
      expect(screen.getByText(/downloaded the image instead/)).toBeInTheDocument(),
    );
  });

  it("auto-fills fields from a CoA/image URL", async () => {
    await renderApp();

    await userEvent.type(
      screen.getByLabelText("CoA / image URL → auto-fill"),
      "https://coa.vendor.com/a.pdf",
    );
    await userEvent.click(screen.getByRole("button", { name: "Fetch" }));

    expect(fetchCoaImage).toHaveBeenCalledWith(
      "https://coa.vendor.com/a.pdf",
      expect.objectContaining({ rasterizePdf: expect.any(Function) }),
    );
    await waitFor(() => expect(screen.getByDisplayValue("TB-500")).toBeInTheDocument());
    expect(screen.getByText(/from the CoA URL/)).toBeInTheDocument();
  });

  it("uses the CoA vial mg over the dropdown default", async () => {
    // Form starts at the BPC-157 default of 10 mg; the CoA reports 20 mg.
    vi.mocked(extractPeptideFromImage).mockResolvedValueOnce({
      peptideName: "BPC-157",
      vialMg: 20,
    });
    await renderApp();
    expect(screen.getByLabelText("Vial mg")).toHaveValue(10);

    await userEvent.type(
      screen.getByLabelText("CoA / image URL → auto-fill"),
      "https://coa.vendor.com/a.pdf",
    );
    await userEvent.click(screen.getByRole("button", { name: "Fetch" }));

    // CoA amount wins over the 10 mg default.
    await waitFor(() => expect(screen.getByLabelText("Vial mg")).toHaveValue(20));
  });

  it("surfaces an error when the URL fetch fails", async () => {
    vi.mocked(fetchCoaImage).mockRejectedValueOnce(new Error("The URL returned status 404."));
    await renderApp();

    await userEvent.type(
      screen.getByLabelText("CoA / image URL → auto-fill"),
      "https://coa.vendor.com/missing.pdf",
    );
    await userEvent.click(screen.getByRole("button", { name: "Fetch" }));

    await waitFor(() => expect(screen.getByText(/status 404/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Print" })).toBeEnabled();
  });

  it("blocks printing and surfaces an error when the name is empty", async () => {
    await renderApp();
    await userEvent.clear(screen.getByLabelText("Peptide name"));

    expect(screen.getByText("Peptide name is required")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Print" })).toBeDisabled();
  });

  it("discovers models from the endpoint and defaults to a vision model", async () => {
    await renderApp();
    const select = screen.getByLabelText("Model") as HTMLSelectElement;

    await waitFor(() => expect(select.value).toBe("gemma-4-31b"));
    expect(screen.getByRole("option", { name: "qwen3.6-27b" })).toBeInTheDocument();
  });

  it("defaults the endpoint field and rediscovers models when it changes", async () => {
    await renderApp();
    const endpoint = screen.getByLabelText("LLM endpoint") as HTMLInputElement;
    expect(endpoint.value).toBe("http://rastalinuxai.local:8081/v1");

    vi.mocked(listModels).mockResolvedValueOnce([{ id: "custom-vlm" }]);
    await userEvent.clear(endpoint);
    await userEvent.type(endpoint, "http://other.local:9000/v1{Enter}");

    await waitFor(() =>
      expect(listModels).toHaveBeenCalledWith(
        expect.objectContaining({ baseUrl: "http://other.local:9000/v1" }),
      ),
    );
    await waitFor(() =>
      expect(screen.getByRole("option", { name: "custom-vlm" })).toBeInTheDocument(),
    );
  });

  it("passes the endpoint base URL through to image extraction", async () => {
    await renderApp();
    const file = new File(["x"], "vial.png", { type: "image/png" });

    await userEvent.upload(screen.getByLabelText("Vial photo → auto-fill"), file);

    await waitFor(() =>
      expect(extractPeptideFromImage).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ baseUrl: "http://rastalinuxai.local:8081/v1" }),
        expect.any(Function), // signal-bound fetch for cancel/timeout
      ),
    );
  });

  it("keeps working when model discovery fails", async () => {
    vi.mocked(listModels).mockRejectedValueOnce(new Error("endpoint down"));
    render(<App />);

    await waitFor(() => expect(screen.getByText(/endpoint down/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Print" })).toBeEnabled();
  });

  it("shows a live progress indicator while auto-filling, then clears it", async () => {
    const d = deferred<{ peptideName: string; vialMg: number }>();
    vi.mocked(extractPeptideFromImage).mockReturnValueOnce(d.promise);
    await renderApp();
    const file = new File(["x"], "vial.png", { type: "image/png" });

    await userEvent.upload(screen.getByLabelText("Vial photo → auto-fill"), file);

    // Progress is visible while inference runs.
    expect(await screen.findByText(/Reading the vial photo/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();

    await act(async () => {
      d.resolve({ peptideName: "TB-500", vialMg: 10 });
    });

    await waitFor(() => expect(screen.getByDisplayValue("TB-500")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
  });

  it("cancels a running auto-fill and shows a cancelled notice", async () => {
    const d = deferred<Record<string, never>>();
    vi.mocked(extractPeptideFromImage).mockReturnValueOnce(d.promise);
    await renderApp();
    const file = new File(["x"], "vial.png", { type: "image/png" });

    await userEvent.upload(screen.getByLabelText("Vial photo → auto-fill"), file);
    await userEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    // The abort would reject the in-flight extraction; simulate that.
    await act(async () => {
      d.reject(new DOMException("aborted", "AbortError"));
    });

    await waitFor(() => expect(screen.getByText("Auto-fill cancelled.")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
  });

  it("auto-fills fields from a vial photo via the LLM", async () => {
    await renderApp();
    const file = new File(["x"], "vial.png", { type: "image/png" });

    await userEvent.upload(screen.getByLabelText("Vial photo → auto-fill"), file);

    expect(fileToDataUrl).toHaveBeenCalledWith(file);
    await waitFor(() => expect(screen.getByDisplayValue("TB-500")).toBeInTheDocument());
    expect(screen.getByDisplayValue("10")).toBeInTheDocument();
  });

  it("reads a CoA from a QR code and flags a mismatch vs the vial photo", async () => {
    vi.mocked(decodeQrFromDataUrl).mockResolvedValueOnce("https://coa.vendor.com/a.pdf");
    vi.mocked(extractPeptideFromImage)
      .mockResolvedValueOnce({ peptideName: "BPC-157", vialMg: 5 }) // vial photo
      .mockResolvedValueOnce({ peptideName: "BPC-157", vialMg: 10, lot: "A1", purity: "99.2%" }); // CoA
    await renderApp();
    const file = new File(["x"], "vial.png", { type: "image/png" });

    await userEvent.upload(screen.getByLabelText("Vial photo → auto-fill"), file);

    expect(fetchCoaImage).toHaveBeenCalledWith(
      "https://coa.vendor.com/a.pdf",
      expect.objectContaining({ rasterizePdf: expect.any(Function) }),
    );
    // CoA wins the merge, and the disagreement is surfaced.
    await waitFor(() => expect(screen.getByDisplayValue("10")).toBeInTheDocument());
    expect(screen.getByText(/Vial mg: photo "5" vs CoA "10"/)).toBeInTheDocument();
    expect(screen.getByText(/purity 99.2%/)).toBeInTheDocument();
  });

  it("shows an error when extraction fails", async () => {
    vi.mocked(extractPeptideFromImage).mockRejectedValueOnce(new Error("LLM offline"));
    await renderApp();
    const file = new File(["x"], "vial.png", { type: "image/png" });

    await userEvent.upload(screen.getByLabelText("Vial photo → auto-fill"), file);

    await waitFor(() => expect(screen.getByText("LLM offline")).toBeInTheDocument());
  });

  it("degrades to manual entry when the photo yields no fields", async () => {
    vi.mocked(extractPeptideFromImage).mockResolvedValueOnce({});
    await renderApp();
    const file = new File(["x"], "vial.png", { type: "image/png" });

    await userEvent.upload(screen.getByLabelText("Vial photo → auto-fill"), file);

    await waitFor(() => expect(screen.getByText(/No details could be read/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Print" })).toBeEnabled();
  });

  it("fails gracefully when the endpoint has no vision model", async () => {
    vi.mocked(extractPeptideFromImage).mockRejectedValueOnce(
      new Error(
        "The inference endpoint has no multimodal (vision) model loaded, so it can't read the photo. Enter the label details manually.",
      ),
    );
    await renderApp();
    const file = new File(["x"], "vial.png", { type: "image/png" });

    await userEvent.upload(screen.getByLabelText("Vial photo → auto-fill"), file);

    await waitFor(() =>
      expect(screen.getByText(/no multimodal \(vision\) model/i)).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Print" })).toBeEnabled();
  });
});
