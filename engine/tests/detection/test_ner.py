from __future__ import annotations

from anonymizer_engine.detection.ner import _detect_street_addresses


def test_street_address_with_building_and_apartment_number() -> None:
    text = "ul. Grażyny nr 5A lok. 12, 80-438 Gdańsk"

    entities = _detect_street_addresses(text)

    assert len(entities) == 1
    assert entities[0].text == "ul. Grażyny nr 5A lok. 12"


def test_street_address_with_nominative_plac_prefix() -> None:
    text = "Plac Piłsudskiego 1, 00-078 Warszawa"

    entities = _detect_street_addresses(text)

    assert len(entities) == 1
    assert entities[0].text == "Plac Piłsudskiego 1"


def test_street_address_without_apartment_number_still_matches() -> None:
    text = "ul. Mickiewicza 163"

    entities = _detect_street_addresses(text)

    assert len(entities) == 1
    assert entities[0].text == "ul. Mickiewicza 163"
