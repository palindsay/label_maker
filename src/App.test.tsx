import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { decodeQrFromDataUrl } from "./browser";
import { fetchCoaImage } from "./coa";
import { fileToDataUrl } from "./image";
import { extractPeptideFromImage, listModels } from "./llm/client";

vi.mock("./image", () => ({
  fileToDataUrl: vi.fn(async () => "data:image/png;base64,x"),
}));

// Browser-only glue (canvas / pdf.js) is unavailable in jsdom — stub it.
vi.mock("./browser", () => ({
  decodeQrFromDataUrl: vi.fn(async () => null),
  rasterizePdfToDataUrl: vi.fn(async () => "data:image/png;base64,PDF"),
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
});

/** Render and wait for model discovery to settle. */
async function renderApp() {
  render(<App />);
  await screen.findByRole("option", { name: "gemma-4-31b" });
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

  it("blocks printing and surfaces an error when the name is empty", async () => {
    await renderApp();
    await userEvent.clear(screen.getByLabelText("Peptide name"));

    expect(screen.getByText("Peptide name is required")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Print" })).toBeDisabled();
  });

  it("discovers models from the endpoint and defaults to a vision model", async () => {
    await renderApp();
    const select = screen.getByLabelText("Vision model") as HTMLSelectElement;

    await waitFor(() => expect(select.value).toBe("gemma-4-31b"));
    expect(screen.getByRole("option", { name: "qwen3.6-27b" })).toBeInTheDocument();
  });

  it("keeps working when model discovery fails", async () => {
    vi.mocked(listModels).mockRejectedValueOnce(new Error("endpoint down"));
    render(<App />);

    await waitFor(() => expect(screen.getByText(/endpoint down/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Print" })).toBeEnabled();
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
    expect(screen.getByText(/CoA purity 99.2%/)).toBeInTheDocument();
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
