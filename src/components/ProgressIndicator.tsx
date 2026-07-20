type ProgressIndicatorProps = {
  /** Human label for the current stage. */
  label: string;
  /** Formatted elapsed time, e.g. "12s". */
  elapsed: string;
  /** Optional sub-line, e.g. the model name. */
  detail?: string | undefined;
  /** Abort the in-flight auto-fill. */
  onCancel: () => void;
};

/**
 * Live progress for a running auto-fill: spinner, current stage, elapsed time,
 * an indeterminate bar (inference duration is unknown), and a Cancel button.
 * Presentational only.
 */
export function ProgressIndicator({ label, elapsed, detail, onCancel }: ProgressIndicatorProps) {
  return (
    <output className="progress" aria-live="polite">
      <div className="progress-row">
        <span className="spinner" aria-hidden="true" />
        <span className="progress-label">{label}</span>
        <span className="progress-elapsed" aria-label={`elapsed ${elapsed}`}>
          {elapsed}
        </span>
        <button type="button" className="progress-cancel" onClick={onCancel}>
          Cancel
        </button>
      </div>
      <div className="progress-bar" aria-hidden="true">
        <span />
      </div>
      {detail && <p className="progress-detail">{detail}</p>}
    </output>
  );
}
