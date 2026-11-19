import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";

import type { PopoverPosition } from "../types";

const MARGIN = 8;

interface Size {
  width: number;
  height: number;
}

// Keeps a popover inside the window: shifted left at the right edge, opened above the
// anchor when there is no room below, pinned to the edge (and scrollable) as a last resort.
export function placePopover(
  position: PopoverPosition,
  popover: Size,
  viewport: Size,
): { left: number; top: number } {
  const maxLeft = viewport.width - popover.width - MARGIN;
  const left = Math.max(MARGIN, Math.min(position.x, maxLeft));

  let top = position.y;
  if (top + popover.height > viewport.height - MARGIN) {
    const above =
      position.anchorTop === undefined
        ? null
        : position.anchorTop - MARGIN - popover.height;
    top =
      above !== null && above >= MARGIN
        ? above
        : Math.max(MARGIN, viewport.height - popover.height - MARGIN);
  }
  return { left, top };
}

export function usePopoverPlacement(position: PopoverPosition) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({
    left: position.x,
    top: position.y,
    visibility: "hidden",
  });

  useLayoutEffect(() => {
    const place = () => {
      const element = ref.current;
      if (!element) {
        return;
      }
      const { left, top } = placePopover(
        position,
        { width: element.offsetWidth, height: element.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
      );
      setStyle({ left, top });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [position.x, position.y, position.anchorTop]);

  return { ref, style };
}
