import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { reconstitution } from "../label/peptide";
import { DosingSummary } from "./DosingSummary";

// 5 mg / 2 mL / 250 mcg -> 2.5 mg/mL, draw 0.1 mL, 10 IU, 20 doses/vial.
const recon = reconstitution({ vialMg: 5, bacWaterMl: 2, doseMcg: 250 });

describe("DosingSummary", () => {
  it("renders the derived dosing rows", () => {
    render(<DosingSummary recon={recon} basis={null} />);
    expect(screen.getByText(/Draw 0\.1 mL/)).toBeInTheDocument();
    expect(screen.getByText(/Syringe 10 IU/)).toBeInTheDocument();
    expect(screen.getByText(/2\.5 mg\/mL/)).toBeInTheDocument();
    expect(screen.getByText(/20 doses\/vial/)).toBeInTheDocument();
  });

  it("shows the CoA basis line (measured drives dosing, label claim, purity)", () => {
    render(
      <DosingSummary recon={recon} basis={{ measuredMg: 10.31, labeledMg: 10, purity: "99.8%" }} />,
    );
    const line = screen.getByText(/Measured 10\.31 mg drives dosing/);
    expect(line.textContent).toMatch(/label claim 10 mg/);
    expect(line.textContent).toMatch(/99\.8% purity/);
  });

  it("omits the basis line when basis is null but still renders dosing", () => {
    render(<DosingSummary recon={recon} basis={null} />);
    expect(screen.queryByText(/drives dosing/)).toBeNull();
    expect(screen.getByText(/Syringe 10 IU/)).toBeInTheDocument();
  });

  it("renders nothing when both recon and basis are null", () => {
    const { container } = render(<DosingSummary recon={null} basis={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("is marked no-print (screen only)", () => {
    const { container } = render(<DosingSummary recon={recon} basis={null} />);
    expect(container.querySelector(".dosing-summary")?.className).toContain("no-print");
  });
});
