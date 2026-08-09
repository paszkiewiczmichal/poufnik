from __future__ import annotations

from dataclasses import dataclass

from anonymizer_engine.detection import EntityCategory, ValidationStatus, detect_all
from anonymizer_engine.detection.models import DetectedEntity
from anonymizer_engine.detection.ner import resolve_spacy_model, spacy_model_available
from anonymizer_engine.testing.fakes import generate_land_register, generate_passport


@dataclass(frozen=True)
class Token:
    text: str
    idx: int
    lemma_: str


class FakeNerEngine:
    def __init__(self) -> None:
        self.last_tokens: list[Token] = []

    def analyze(self, text: str, language: str) -> list[DetectedEntity]:
        assert language == "pl"
        person_start = text.index("Janem Kowalskim")
        address_start = text.index("Gdańsku")
        pesel_start = text.index("44051401359")
        self.last_tokens = [
            Token("Janem", person_start, "jan"),
            Token("Kowalskim", person_start + len("Janem "), "kowalski"),
            Token("Gdańsku", address_start, "gdańsk"),
        ]
        return [
            DetectedEntity(
                category=EntityCategory.PERSON,
                start=person_start,
                end=person_start + len("Janem Kowalskim"),
                text="Janem Kowalskim",
                confidence=0.9,
                source="ner",
                validation=ValidationStatus.NOT_APPLICABLE,
            ),
            DetectedEntity(
                category=EntityCategory.ADDRESS,
                start=address_start,
                end=address_start + len("Gdańsku"),
                text="Gdańsku",
                confidence=0.9,
                source="ner",
                validation=ValidationStatus.NOT_APPLICABLE,
            ),
            DetectedEntity(
                category=EntityCategory.DATE,
                start=pesel_start,
                end=pesel_start + len("44051401359"),
                text="44051401359",
                confidence=0.2,
                source="ner",
                validation=ValidationStatus.NOT_APPLICABLE,
            ),
        ]


class PostalNerEngine:
    last_tokens: list[Token] = []

    def analyze(self, text: str, language: str) -> list[DetectedEntity]:
        assert language == "pl"
        city_start = text.index("Gdyni")
        street_start = text.index("ul. Portowa 12")
        return [
            DetectedEntity(
                category=EntityCategory.ADDRESS,
                start=city_start,
                end=city_start + len("Gdyni"),
                text="Gdyni",
                confidence=0.9,
                source="ner",
                validation=ValidationStatus.NOT_APPLICABLE,
            ),
            DetectedEntity(
                category=EntityCategory.ADDRESS,
                start=street_start,
                end=street_start + len("ul. Portowa 12"),
                text="ul. Portowa 12",
                confidence=0.78,
                source="ner",
                validation=ValidationStatus.NOT_APPLICABLE,
            ),
        ]


class EmptyNerEngine:
    last_tokens: list[Token] = []

    def analyze(self, text: str, language: str) -> list[DetectedEntity]:
        assert text
        assert language == "pl"
        return []


def test_detect_all_merges_layers_and_prefers_deterministic_overlaps() -> None:
    text = "Umowę zawarto z Janem Kowalskim (PESEL 44051401359), zam. w Gdańsku."

    result = detect_all(text, ner_engine=FakeNerEngine())

    categories = [entity.category for entity in result.entities]
    assert EntityCategory.PERSON in categories
    assert EntityCategory.PESEL in categories
    assert EntityCategory.ADDRESS in categories
    assert EntityCategory.DATE not in categories
    person = next(entity for entity in result.entities if entity.category is EntityCategory.PERSON)
    pesel = next(entity for entity in result.entities if entity.category is EntityCategory.PESEL)
    assert person.canonical_text == "Jan Kowalski"
    assert pesel.validation == ValidationStatus.PASSED


def test_detect_all_merges_postal_code_with_adjacent_address_spans() -> None:
    text = "z siedzibą w Gdyni (81-300), ul. Portowa 12"

    result = detect_all(text, ner_engine=PostalNerEngine())

    assert [(entity.text, entity.category) for entity in result.entities] == [
        ("Gdyni (81-300), ul. Portowa 12", EntityCategory.ADDRESS)
    ]


def test_new_deterministic_categories_survive_full_pipeline() -> None:
    text = (
        f"Paszport {generate_passport()}; karta 4111 1111 1111 1111; "
        f"księga {generate_land_register()}; znak sprawy DOP-1.4131.15.2026; "
        "GPS 54.3520, 18.6466; IP 192.0.2.15; MAC 02:00:5E:10:00:00; "
        "token ghp_0123456789abcdefghijABCDEFGHIJ12; kwota 1 234,56 PLN; "
        "data urodzenia 12.03.1985."
    )

    result = detect_all(text, ner_engine=EmptyNerEngine())

    expected_categories = {
        EntityCategory.PASSPORT,
        EntityCategory.PAYMENT_CARD,
        EntityCategory.LAND_REGISTER,
        EntityCategory.ADMIN_CASE,
        EntityCategory.GPS,
        EntityCategory.IP_ADDRESS,
        EntityCategory.MAC_ADDRESS,
        EntityCategory.API_KEY,
        EntityCategory.MONEY,
        EntityCategory.DATE,
    }
    assert expected_categories <= {entity.category for entity in result.entities}
    for category in expected_categories:
        assert sum(entity.category is category for entity in result.entities) == 1


def test_resolves_spacy_model_from_pyinstaller_internal_dir(tmp_path, monkeypatch) -> None:
    model_dir = tmp_path / "fake_pl_model" / "fake_pl_model-1.0.0"
    model_dir.mkdir(parents=True)
    (model_dir / "config.cfg").write_text("[nlp]\nlang = \"pl\"\n", encoding="utf-8")

    monkeypatch.setattr("sys._MEIPASS", str(tmp_path), raising=False)

    assert resolve_spacy_model("fake_pl_model") == str(model_dir)
    assert spacy_model_available("fake_pl_model") is True
