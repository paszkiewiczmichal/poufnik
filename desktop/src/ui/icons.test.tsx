import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CheckIcon, ErrorIcon, FileIcon, LockIcon, PlusIcon, UploadIcon } from "./icons";

describe("icons", () => {
  it.each([
    ["LockIcon", LockIcon],
    ["FileIcon", FileIcon],
    ["UploadIcon", UploadIcon],
    ["CheckIcon", CheckIcon],
    ["ErrorIcon", ErrorIcon],
    ["PlusIcon", PlusIcon],
  ] as const)("%s renders an accessibility-hidden svg", (_name, Icon) => {
    const { container } = render(<Icon />);
    const svg = container.querySelector("svg")!;

    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
  });

  it("lets a custom className override merge with the base props", () => {
    const { container } = render(<CheckIcon className="entity-status-icon" />);

    expect(container.querySelector("svg")).toHaveClass("entity-status-icon");
  });
});
