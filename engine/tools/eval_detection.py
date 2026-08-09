from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

from anonymizer_engine.detection import EntityCategory, detect_all

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CORPUS = REPO_ROOT / "corpus" / "detection_eval.jsonl"
DEFAULT_OUTPUT = REPO_ROOT / "engine" / "eval_detection_results.json"

REQUIRED_RECALL = {
    EntityCategory.PERSON.value: 0.90,
    EntityCategory.COMPANY.value: 0.85,
    EntityCategory.PESEL.value: 0.99,
    EntityCategory.NIP.value: 0.99,
    EntityCategory.REGON.value: 0.99,
    EntityCategory.ID_CARD.value: 0.99,
    EntityCategory.BANK_ACCOUNT.value: 0.99,
    EntityCategory.PASSPORT.value: 0.99,
    EntityCategory.PAYMENT_CARD.value: 0.99,
    EntityCategory.LAND_REGISTER.value: 0.99,
    EntityCategory.ADMIN_CASE.value: 0.99,
    EntityCategory.GPS.value: 0.99,
    EntityCategory.IP_ADDRESS.value: 0.99,
    EntityCategory.MAC_ADDRESS.value: 0.99,
    EntityCategory.API_KEY.value: 0.99,
    EntityCategory.MONEY.value: 0.99,
    EntityCategory.VEHICLE.value: 0.99,
    EntityCategory.CASE_NUMBER.value: 0.99,
}
MIN_OVERALL_PRECISION = 0.95


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--corpus", type=Path, default=DEFAULT_CORPUS)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    records = _load_jsonl(args.corpus)
    stats = _evaluate(records)
    _print_table(stats)
    args.output.write_text(json.dumps(stats, ensure_ascii=False, indent=2), encoding="utf-8")
    return _exit_code(stats)


def _load_jsonl(path: Path) -> list[dict[str, Any]]:
    with path.open(encoding="utf-8") as corpus:
        return [json.loads(line) for line in corpus if line.strip()]


def _evaluate(records: list[dict[str, Any]]) -> dict[str, Any]:
    counts: dict[str, dict[str, int]] = defaultdict(lambda: {"tp": 0, "fp": 0, "fn": 0})
    person_layers: dict[str, dict[str, int]] = {
        "dictionary_only": {"predicted": 0, "tp": 0},
        "ner_only": {"predicted": 0, "tp": 0},
        "dictionary_and_ner": {"predicted": 0, "tp": 0},
    }
    public_institution_sensitive_fp = 0

    for record in records:
        gold = record["entities"]
        detection = detect_all(record["text"])
        predicted = []
        for entity in detection.entities:
            predicted_entity = {
                "start": entity.start,
                "end": entity.end,
                "category": entity.category.value,
                "source": entity.source,
                "corroborated_by": entity.corroborated_by,
            }
            predicted.append(predicted_entity)
            if entity.category is EntityCategory.PERSON:
                person_layers[_person_layer(predicted_entity)]["predicted"] += 1

        document_matches = _match_document(gold, predicted)
        public_institution_sensitive_fp += _public_institution_sensitive_false_positives(
            gold,
            predicted,
        )
        for category, category_counts in document_matches.items():
            counts[category]["tp"] += category_counts["tp"]
            counts[category]["fp"] += category_counts["fp"]
            counts[category]["fn"] += category_counts["fn"]
        for matched_person in _matched_person_predictions(gold, predicted):
            person_layers[_person_layer(matched_person)]["tp"] += 1

    per_category = {
        category: _metrics(category_counts)
        for category, category_counts in sorted(counts.items())
    }
    total_counts = {
        "tp": sum(item["tp"] for item in counts.values()),
        "fp": sum(item["fp"] for item in counts.values()),
        "fn": sum(item["fn"] for item in counts.values()),
    }
    return {
        "documents": len(records),
        "iou_threshold": 0.5,
        "per_category": per_category,
        "person_layers": person_layers,
        "public_institution_sensitive_fp": public_institution_sensitive_fp,
        "overall": _metrics(total_counts),
        "thresholds": {
            "required_recall": REQUIRED_RECALL,
            "min_overall_precision": MIN_OVERALL_PRECISION,
            "max_public_institution_sensitive_fp": 0,
        },
    }


def _match_document(
    gold: list[dict[str, Any]],
    predicted: list[dict[str, Any]],
) -> dict[str, dict[str, int]]:
    categories = {item["category"] for item in gold} | {item["category"] for item in predicted}
    result: dict[str, dict[str, int]] = {}
    for category in categories:
        gold_for_category = [item for item in gold if item["category"] == category]
        predicted_for_category = [item for item in predicted if item["category"] == category]
        matches = _greedy_matches(gold_for_category, predicted_for_category)
        true_positive = len(matches)
        result[category] = {
            "tp": true_positive,
            "fp": len(predicted_for_category) - true_positive,
            "fn": len(gold_for_category) - true_positive,
        }
    return result


def _matched_person_predictions(
    gold: list[dict[str, Any]],
    predicted: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    gold_people = [item for item in gold if item["category"] == EntityCategory.PERSON.value]
    predicted_people = [
        item for item in predicted if item["category"] == EntityCategory.PERSON.value
    ]
    return [
        predicted_people[predicted_index]
        for _gold_index, predicted_index in _greedy_matches(gold_people, predicted_people)
    ]


def _public_institution_sensitive_false_positives(
    gold: list[dict[str, Any]],
    predicted: list[dict[str, Any]],
) -> int:
    public_institutions = [
        item for item in gold if item["category"] == EntityCategory.PUBLIC_INSTITUTION.value
    ]
    sensitive_predictions = [
        item
        for item in predicted
        if item["category"] in {EntityCategory.PERSON.value, EntityCategory.COMPANY.value}
    ]
    return sum(
        1
        for prediction in sensitive_predictions
        if any(_spans_overlap(prediction, public) for public in public_institutions)
    )


def _person_layer(entity: dict[str, Any]) -> str:
    if entity.get("source") == "ner" and "dictionary" in entity.get("corroborated_by", []):
        return "dictionary_and_ner"
    if entity.get("source") == "ner":
        return "ner_only"
    return "dictionary_only"


def _greedy_matches(
    gold: list[dict[str, Any]],
    predicted: list[dict[str, Any]],
) -> list[tuple[int, int]]:
    candidates: list[tuple[float, int, int]] = []
    for gold_index, gold_entity in enumerate(gold):
        for predicted_index, predicted_entity in enumerate(predicted):
            iou = _span_iou(gold_entity, predicted_entity)
            if iou >= 0.5:
                candidates.append((iou, gold_index, predicted_index))

    matches: list[tuple[int, int]] = []
    used_gold: set[int] = set()
    used_predicted: set[int] = set()
    for _iou, gold_index, predicted_index in sorted(candidates, reverse=True):
        if gold_index in used_gold or predicted_index in used_predicted:
            continue
        used_gold.add(gold_index)
        used_predicted.add(predicted_index)
        matches.append((gold_index, predicted_index))
    return matches


def _span_iou(left: dict[str, Any], right: dict[str, Any]) -> float:
    intersection = max(0, min(left["end"], right["end"]) - max(left["start"], right["start"]))
    union = max(left["end"], right["end"]) - min(left["start"], right["start"])
    return intersection / union if union else 0.0


def _spans_overlap(left: dict[str, Any], right: dict[str, Any]) -> bool:
    return left["start"] < right["end"] and right["start"] < left["end"]


def _metrics(counts: dict[str, int]) -> dict[str, float | int]:
    true_positive = counts["tp"]
    false_positive = counts["fp"]
    false_negative = counts["fn"]
    precision_denominator = true_positive + false_positive
    recall_denominator = true_positive + false_negative
    precision = true_positive / precision_denominator if precision_denominator else 0.0
    recall = true_positive / recall_denominator if recall_denominator else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    return {
        "tp": true_positive,
        "fp": false_positive,
        "fn": false_negative,
        "precision": precision,
        "recall": recall,
        "f1": f1,
    }


def _print_table(stats: dict[str, Any]) -> None:
    header = (
        f"{'category':<14} {'tp':>4} {'fp':>4} {'fn':>4} "
        f"{'precision':>10} {'recall':>8} {'f1':>8}"
    )
    print(header)
    print("-" * len(header))
    for category, metrics in stats["per_category"].items():
        print(
            f"{category:<14} {metrics['tp']:>4} {metrics['fp']:>4} {metrics['fn']:>4} "
            f"{metrics['precision']:>10.3f} {metrics['recall']:>8.3f} {metrics['f1']:>8.3f}"
        )
    overall = stats["overall"]
    print("-" * len(header))
    print(
        f"{'OVERALL':<14} {overall['tp']:>4} {overall['fp']:>4} {overall['fn']:>4} "
        f"{overall['precision']:>10.3f} {overall['recall']:>8.3f} {overall['f1']:>8.3f}"
    )
    print("\nPERSON layer report")
    print(f"{'layer':<20} {'predicted':>9} {'tp':>4}")
    print("-" * 36)
    for layer, metrics in stats["person_layers"].items():
        print(f"{layer:<20} {metrics['predicted']:>9} {metrics['tp']:>4}")
    print(
        "\nPUBLIC_INSTITUTION false positives in PERSON/COMPANY: "
        f"{stats['public_institution_sensitive_fp']}"
    )


def _exit_code(stats: dict[str, Any]) -> int:
    failures = []
    for category, minimum in REQUIRED_RECALL.items():
        recall = stats["per_category"].get(category, {}).get("recall", 0.0)
        if recall < minimum:
            failures.append(f"recall {category} {recall:.3f} < {minimum:.3f}")
    precision = stats["overall"]["precision"]
    if precision < MIN_OVERALL_PRECISION:
        failures.append(f"overall precision {precision:.3f} < {MIN_OVERALL_PRECISION:.3f}")
    if stats["public_institution_sensitive_fp"] > 0:
        failures.append(
            "public institutions classified as PERSON/COMPANY "
            f"{stats['public_institution_sensitive_fp']} > 0"
        )
    if failures:
        for failure in failures:
            print(f"FAIL: {failure}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
