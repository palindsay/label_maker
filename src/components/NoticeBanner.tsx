import type { Notice } from "../notices";

const ICONS: Record<Notice["kind"], string> = {
  success: "✓",
  warning: "⚠",
  error: "✕",
  info: "ℹ",
};

/** A single notification banner (info/success/warning/error). Presentational. */
export function NoticeBanner({ kind, text }: Notice) {
  return (
    <p className={`notice notice--${kind}`} role={kind === "error" ? "alert" : "status"}>
      <span className="notice-icon" aria-hidden="true">
        {ICONS[kind]}
      </span>
      <span>{text}</span>
    </p>
  );
}
