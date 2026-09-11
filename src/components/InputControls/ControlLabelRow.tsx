import type { ReactNode } from "react";
import { PromotedWidgetIcon } from "../icons";
import { useI18n } from "@/i18n";
import { controlLabelRowClassName } from "./controlStyles";

interface ControlLabelRowProps {
  name: string;
  displayLabel?: string;
  isPromoted?: boolean;
  /** "⇠ slot" text naming the boundary input this promoted widget drives. */
  boundaryAnnotation?: string;
  /**
   * Jump to that boundary slot's row in the subgraph connections section.
   * When set, the annotation and the promoted marker render as ONE button
   * (text first, marker on its right); without it they draw as static text,
   * exactly as this row always has.
   */
  onBoundaryJump?: () => void;
  labelAccessory?: ReactNode;
  /** Extra classes on the row div — most controls want spacing below it. */
  className?: string;
  /** Size/color of the promoted-widget marker; a couple of controls want it larger. */
  iconClassName?: string;
}

/**
 * The label row shared by the standard input controls: widget name, an
 * optional "⇠ slot" boundary annotation with the promoted-widget marker, and
 * a trailing accessory (e.g. the row's `...` menu).
 *
 * The accessory — and the boundary-jump button — are SIBLINGS of the <label>,
 * never inside it: a label forwards clicks to its first labelable descendant,
 * which would turn the widget's name into a second trigger for them.
 */
export function ControlLabelRow({
  name,
  displayLabel,
  isPromoted,
  boundaryAnnotation,
  onBoundaryJump,
  labelAccessory,
  className = "mb-1",
  iconClassName = "w-5 h-5 text-pink-500",
}: ControlLabelRowProps) {
  const { t } = useI18n();
  const marker = isPromoted
    ? <PromotedWidgetIcon className={`shrink-0 ${iconClassName}`} />
    : null;
  const jumpable = onBoundaryJump && (boundaryAnnotation || isPromoted);

  if (!jumpable) {
    return (
      <div className={`${controlLabelRowClassName} ${className}`.trim()}>
        <label className="inline-flex min-w-0 items-center gap-1">
          <span>
            {displayLabel ?? name}
            {boundaryAnnotation ? ` ${boundaryAnnotation}` : ""}
          </span>
          {marker}
        </label>
        {labelAccessory}
      </div>
    );
  }

  return (
    <div className={`${controlLabelRowClassName} ${className}`.trim()}>
      <label className="inline-flex min-w-0 items-center gap-1">
        <span>{displayLabel ?? name}</span>
      </label>
      <button
        type="button"
        className="boundary-jump inline-flex min-w-0 shrink-0 items-center gap-1 transition-colors hover:text-cyan-300 active:scale-95"
        aria-label={t("Show boundary input")}
        onClick={(event) => {
          event.stopPropagation();
          onBoundaryJump();
        }}
      >
        {boundaryAnnotation && <span className="truncate">{boundaryAnnotation}</span>}
        {marker}
      </button>
      {labelAccessory}
    </div>
  );
}
