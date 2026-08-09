import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CategoryLegend } from "./CategoryLegend";
import type { DetectedEntity } from "../types";

describe("CategoryLegend", () => {
  it("shows category counts and toggles visibility", () => {
    const onToggleCategory = vi.fn();
    render(
      <CategoryLegend
        entities={[
          entity("PERSON", "Jan"),
          entity("PERSON", "Anna"),
          entity("PESEL", "44051401359"),
          entity("API_KEY", "ghp_fake_token_value"),
          entity("MONEY", "1 234,56"),
        ]}
        hiddenCategories={["PESEL"]}
        onToggleCategory={onToggleCategory}
        onRedetect={vi.fn()}
        redetectDisabled={false}
        redetectLoading={false}
      />,
    );

    expect(screen.getByText("Osoba")).toBeInTheDocument();
    expect(screen.getByText("PESEL")).toBeInTheDocument();
    expect(screen.getByText("Klucz API")).toBeInTheDocument();
    expect(screen.getByText("Kwota")).toBeInTheDocument();
    expect(screen.getByText("Łącznie:")).toBeInTheDocument();
    expect(screen.getAllByText("2")[0]).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/Pokaż podświetlenia: PESEL/i));

    expect(onToggleCategory).toHaveBeenCalledWith("PESEL");
  });
});

function entity(category: DetectedEntity["category"], text: string): DetectedEntity {
  return {
    id: `${category}-${text}`,
    category,
    start: 0,
    end: text.length,
    text,
    confidence: 1,
    source: "regex",
    validation: "passed",
    status: "accepted",
    entity_group_id: `${category}:${text}`,
    canonical_text: text,
  };
}
