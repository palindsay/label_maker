import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { fileToDataUrl } from "./image";
import { extractPeptideFromImage } from "./llm/client";

vi.mock("./image", () => ({
  fileToDataUrl: vi.fn(async () => "data:image/png;base64,x"),
}));
vi.mock("./llm/client", () => ({
  extractPeptideFromImage: vi.fn(async () => ({ peptideName: "TB-500", vialMg: 10 })),
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(extractPeptideFromImage).mockResolvedValue({ peptideName: "TB-500", vialMg: 10 });
});

describe("App", () => {
  it("renders the default peptide label and prints on demand", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    render(<App />);

    expect(screen.getByRole("heading", { name: "Peptide Label Maker" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("BPC-157")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Print" }));
    expect(print).toHaveBeenCalledOnce();
  });

  it("blocks printing and surfaces an error when the name is empty", async () => {
    render(<App />);
    await userEvent.clear(screen.getByLabelText("Peptide name"));

    expect(screen.getByText("Peptide name is required")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Print" })).toBeDisabled();
  });

  it("auto-fills fields from a vial photo via the LLM", async () => {
    render(<App />);
    const file = new File(["x"], "vial.png", { type: "image/png" });

    await userEvent.upload(screen.getByLabelText("Vial photo → auto-fill"), file);

    expect(fileToDataUrl).toHaveBeenCalledWith(file);
    await waitFor(() => expect(screen.getByDisplayValue("TB-500")).toBeInTheDocument());
    expect(screen.getByDisplayValue("10")).toBeInTheDocument();
  });

  it("shows an error when extraction fails", async () => {
    vi.mocked(extractPeptideFromImage).mockRejectedValueOnce(new Error("LLM offline"));
    render(<App />);
    const file = new File(["x"], "vial.png", { type: "image/png" });

    await userEvent.upload(screen.getByLabelText("Vial photo → auto-fill"), file);

    await waitFor(() => expect(screen.getByText("LLM offline")).toBeInTheDocument());
  });
});
