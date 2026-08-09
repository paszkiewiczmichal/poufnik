import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TierGate } from "./TierGate";

describe("TierGate", () => {
  afterEach(() => cleanup());

  it("renders a prompt for Basic users", () => {
    render(
      <TierGate tier="basic" featureName="Historia dokumentów" onRegister={vi.fn()}>
        <div>Early Bird content</div>
      </TierGate>,
    );

    expect(screen.getByTestId("tier-gate")).toHaveTextContent("Early Bird");
    expect(screen.queryByText("Early Bird content")).not.toBeInTheDocument();
  });

  it("renders gated content for Early Bird users", () => {
    render(
      <TierGate tier="early_bird" featureName="Historia dokumentów" onRegister={vi.fn()}>
        <div>Early Bird content</div>
      </TierGate>,
    );

    expect(screen.getByText("Early Bird content")).toBeInTheDocument();
    expect(screen.queryByTestId("tier-gate")).not.toBeInTheDocument();
  });
});
