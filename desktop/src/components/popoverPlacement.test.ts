import { describe, expect, it } from "vitest";

import { placePopover } from "./popoverPlacement";

const viewport = { width: 1000, height: 800 };
const popover = { width: 330, height: 300 };

describe("placePopover", () => {
  it("keeps the requested place when the popover fits", () => {
    expect(
      placePopover({ x: 100, y: 200, anchorTop: 180 }, popover, viewport),
    ).toEqual({
      left: 100,
      top: 200,
    });
  });

  it("opens above the anchor when there is no room below", () => {
    // Selection near the bottom: 700 + 300 would end below the window.
    expect(
      placePopover({ x: 100, y: 700, anchorTop: 680 }, popover, viewport),
    ).toEqual({
      left: 100,
      top: 680 - 8 - 300,
    });
  });

  it("moves left when the anchor is at the right edge", () => {
    // The "Popraw" button in the side panel sits against the right edge.
    expect(
      placePopover({ x: 990, y: 200, anchorTop: 180 }, popover, viewport).left,
    ).toBe(1000 - 330 - 8);
  });

  it("pins to the bottom edge when there is room neither below nor above", () => {
    expect(
      placePopover(
        { x: 100, y: 300, anchorTop: 280 },
        { width: 330, height: 600 },
        viewport,
      ),
    ).toEqual({ left: 100, top: 800 - 600 - 8 });
  });

  it("pins to the bottom edge without an anchor", () => {
    expect(placePopover({ x: 100, y: 700 }, popover, viewport).top).toBe(
      800 - 300 - 8,
    );
  });

  it("never starts above or left of the window margin", () => {
    expect(
      placePopover({ x: -50, y: 700 }, { width: 330, height: 900 }, viewport),
    ).toEqual({
      left: 8,
      top: 8,
    });
  });
});
