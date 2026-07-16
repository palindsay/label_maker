import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { PeptideLabelInput } from "../label/schema";
import { LabelForm } from "./LabelForm";

const base: PeptideLabelInput = {
  peptideName: "BPC-157",
  vialMg: 5,
  bacWaterMl: 2,
  doseMcg: 250,
  lot: "",
  dateReconstituted: "",
  manufacturer: "",
};

function renderForm(overrides: Partial<Parameters<typeof LabelForm>[0]> = {}) {
  const onChange = vi.fn();
  const onImageSelected = vi.fn();
  render(
    <LabelForm
      value={base}
      onChange={onChange}
      onImageSelected={onImageSelected}
      busy={false}
      {...overrides}
    />,
  );
  return { onChange, onImageSelected };
}

describe("LabelForm", () => {
  it("emits an updated peptide name on input", async () => {
    const { onChange } = renderForm();
    await userEvent.type(screen.getByLabelText("Peptide name"), "!");
    expect(onChange).toHaveBeenLastCalledWith({ ...base, peptideName: "BPC-157!" });
  });

  it("emits a numeric vial mass from the custom mg field", () => {
    const { onChange } = renderForm();
    fireEvent.change(screen.getByLabelText("Vial mg"), { target: { value: "7" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...base, vialMg: 7 });
  });

  it("sets the vial mg from the common-amount picker", async () => {
    const { onChange } = renderForm();
    await userEvent.selectOptions(screen.getByLabelText("Common vial mg"), "30");
    expect(onChange).toHaveBeenLastCalledWith({ ...base, vialMg: 30 });
  });

  it("emits the manufacturer on input", async () => {
    const { onChange } = renderForm();
    await userEvent.type(screen.getByLabelText("Manufacturer"), "X");
    expect(onChange).toHaveBeenLastCalledWith({ ...base, manufacturer: "X" });
  });

  it("applies a preset (name + dosing) on selection", async () => {
    const { onChange } = renderForm();
    await userEvent.selectOptions(screen.getByLabelText("Preset"), "Semaglutide");
    expect(onChange).toHaveBeenLastCalledWith({
      ...base,
      peptideName: "Semaglutide",
      vialMg: 5,
      bacWaterMl: 2,
      doseMcg: 250,
    });
  });

  it("forwards a selected vial photo", async () => {
    const { onImageSelected } = renderForm();
    const file = new File(["x"], "vial.png", { type: "image/png" });
    await userEvent.upload(screen.getByLabelText("Vial photo → auto-fill"), file);
    expect(onImageSelected).toHaveBeenCalledWith(file);
  });

  it("disables the photo control while busy", () => {
    renderForm({ busy: true });
    expect(screen.getByLabelText("Vial photo → auto-fill")).toBeDisabled();
  });
});
