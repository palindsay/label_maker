import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { reconstitution } from "../label/peptide";
import type { PeptideLabelInput } from "../label/schema";
import { LabelPreview } from "./LabelPreview";

const base: PeptideLabelInput = {
  peptideName: "BPC-157",
  vialMg: 5,
  bacWaterMl: 2,
  doseMcg: 250,
  lot: "A1",
  dateReconstituted: "2026-07-12",
  manufacturer: "AcmeLabs",
};

describe("LabelPreview", () => {
  it("renders the peptide, amount, hero dosing, and manufacturer", () => {
    render(<LabelPreview label={base} recon={reconstitution(base)} />);

    expect(screen.getByText("BPC-157")).toBeInTheDocument();
    expect(screen.getByText("5 mg")).toBeInTheDocument();
    expect(screen.getByText("10 IU")).toBeInTheDocument(); // the hero draw
    expect(screen.getByText("250 mcg")).toBeInTheDocument();
    expect(screen.getByText("2.5 mg/mL · 2 mL BAC")).toBeInTheDocument();
    expect(screen.getByText("Recon 2026-07-12 · Lot A1")).toBeInTheDocument();
    expect(screen.getByText("AcmeLabs")).toBeInTheDocument();
  });

  it("shows dashes when dosing cannot be computed", () => {
    render(<LabelPreview label={{ ...base, vialMg: Number.NaN }} recon={null} />);
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });

  it("sizes the label to 40mm (~151px at 96dpi)", () => {
    render(<LabelPreview label={base} recon={reconstitution(base)} />);
    const el = screen.getByLabelText("Label preview") as HTMLElement;
    expect(Number.parseFloat(el.style.width)).toBeCloseTo(151.18, 1);
    expect(Number.parseFloat(el.style.height)).toBeCloseTo(52.91, 1);
  });
});
