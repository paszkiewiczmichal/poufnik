import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ReplacementMapTable } from "./ResultView";
import type { ReplacementMap } from "../types";

describe("ReplacementMapTable", () => {
  it("renders token category and original value", () => {
    const replacementMap: ReplacementMap = {
      entries: [
        {
          token: "[OSOBA_1]",
          category: "PERSON",
          canonical_text: "Jan Kowalski",
          variants: ["Jan Kowalski"],
        },
      ],
      document_fingerprint: "abc",
    };

    render(<ReplacementMapTable replacementMap={replacementMap} />);

    expect(screen.getByText("[OSOBA_1]")).toBeInTheDocument();
    expect(screen.getByText("Osoba")).toBeInTheDocument();
    expect(screen.getByText("Jan Kowalski")).toBeInTheDocument();
  });
});
