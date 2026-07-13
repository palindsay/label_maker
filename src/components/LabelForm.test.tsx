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
  note: "",
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

  it("emits a numeric vial mass from the number field", () => {
    const { onChange } = renderForm();
    fireEvent.change(screen.getByLabelText("Vial (mg)"), { target: { value: "7" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...base, vialMg: 7 });
  });

  it("applies a preset (name + dosing) on selection", async () => {
    const { onChange } = renderForm();
    await userEvent.selectOptions(screen.getByLabelText("Preset"), "TB-500");
    expect(onChange).toHaveBeenLastCalledWith({
      ...base,
      peptideName: "TB-500",
      vialMg: 5,
      bacWaterMl: 2,
      doseMcg: 500,
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
