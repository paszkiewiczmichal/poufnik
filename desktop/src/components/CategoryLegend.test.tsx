import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CategoryLegend } from "./CategoryLegend";
import type { DetectedEntity, EntityStatus } from "../types";

describe("CategoryLegend", () => {
  it("shows category counts and switches a whole category in or out of anonymization", () => {
    const onSetCategoryStatus = vi.fn();
    render(
      <CategoryLegend
        entities={[
          entity("PERSON", "Jan"),
          entity("PERSON", "Anna"),
          entity("PESEL", "44051401359", "rejected"),
          entity("API_KEY", "ghp_fake_token_value"),
          entity("MONEY", "1 234,56"),
        ]}
        onSetCategoryStatus={onSetCategoryStatus}
        onRedetect={vi.fn()}
        redetectDisabled={false}
        redetectLoading={false}
      />,
    );

    expect(screen.getByText("Osoba")).toBeInTheDocument();
    expect(screen.getByText("Klucz API")).toBeInTheDocument();
    expect(screen.getByText("Łącznie:")).toBeInTheDocument();
    expect(screen.getAllByText("2")[0]).toBeInTheDocument();

    // PESEL has no marked item, so its chip is off and turns the category back on.
    const pesel = screen.getByLabelText(/Anonimizuj kategorię: PESEL/i);
    expect(pesel).not.toBeChecked();
    fireEvent.click(pesel);
    expect(onSetCategoryStatus).toHaveBeenCalledWith("PESEL", "accepted");

    const person = screen.getByLabelText(/Nie anonimizuj kategorii: Osoba/i);
    expect(person).toBeChecked();
    fireEvent.click(person);
    expect(onSetCategoryStatus).toHaveBeenCalledWith("PERSON", "rejected");
  });
});

function entity(
  category: DetectedEntity["category"],
  text: string,
  status: EntityStatus = "accepted",
): DetectedEntity {
  return {
    id: `${category}-${text}`,
    category,
    start: 0,
    end: text.length,
    text,
    confidence: 1,
    source: "regex",
    validation: "passed",
    status,
    entity_group_id: `${category}:${text}`,
    canonical_text: text,
  };
}
