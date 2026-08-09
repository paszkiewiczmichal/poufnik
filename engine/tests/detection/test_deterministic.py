from __future__ import annotations

import time

import pytest

from anonymizer_engine.detection import (
    EntityCategory,
    ValidationStatus,
    detect_deterministic,
    validate_land_register,
    validate_passport,
    validate_payment_card,
)
from anonymizer_engine.testing.fakes import (
    corrupt_last_digit,
    format_nrb_groups,
    generate_iban_pl,
    generate_id_card,
    generate_land_register,
    generate_nip,
    generate_nrb,
    generate_passport,
    generate_pesel,
    generate_regon9,
    generate_regon14,
)


def _only(text: str, category: EntityCategory) -> list:
    return [entity for entity in detect_deterministic(text) if entity.category == category]


@pytest.mark.parametrize(
    ("text", "category", "expected_text"),
    [
        (f"PESEL {generate_pesel()}", EntityCategory.PESEL, generate_pesel()),
        ("PESEL (44051401359).", EntityCategory.PESEL, "44051401359"),
        (f"NIP {generate_nip()}", EntityCategory.NIP, generate_nip()),
        ("NIP 526-10-40-828", EntityCategory.NIP, "526-10-40-828"),
        ("NIP PL 526-10-40-828", EntityCategory.NIP, "PL 526-10-40-828"),
        ("NIP 526 10 40 828", EntityCategory.NIP, "526 10 40 828"),
        (f"REGON {generate_regon9()}", EntityCategory.REGON, generate_regon9()),
        (f"REGON {generate_regon14()}", EntityCategory.REGON, generate_regon14()),
        (f"Dowod {generate_id_card()}", EntityCategory.ID_CARD, generate_id_card()),
        ("Dowod ABC 612345", EntityCategory.ID_CARD, "ABC 612345"),
        (f"Paszport {generate_passport()}", EntityCategory.PASSPORT, generate_passport()),
        ("KRS 0000123456", EntityCategory.KRS, "0000123456"),
        (f"Rachunek {generate_nrb()}", EntityCategory.BANK_ACCOUNT, generate_nrb()),
        (
            f"Rachunek {format_nrb_groups(generate_nrb())}",
            EntityCategory.BANK_ACCOUNT,
            format_nrb_groups(generate_nrb()),
        ),
        (f"IBAN {generate_iban_pl()}", EntityCategory.BANK_ACCOUNT, generate_iban_pl()),
        ("Karta 4111 1111 1111 1111", EntityCategory.PAYMENT_CARD, "4111 1111 1111 1111"),
        (
            f"Księga {generate_land_register()}",
            EntityCategory.LAND_REGISTER,
            generate_land_register(),
        ),
        ("Telefon +48 601 234 567", EntityCategory.PHONE, "+48 601 234 567"),
        ("Telefon 601-234-567", EntityCategory.PHONE, "601-234-567"),
        ("Telefon (58) 123 45 67", EntityCategory.PHONE, "(58) 123 45 67"),
        ("Telefon 586 123 456", EntityCategory.PHONE, "586 123 456"),
        ("Email anna.nowak@example.com", EntityCategory.EMAIL, "anna.nowak@example.com"),
        ("Strona https://example.com/path?q=1.", EntityCategory.URL, "https://example.com/path?q=1"),
        ("Strona www.example.com/oferta", EntityCategory.URL, "www.example.com/oferta"),
        ("IPv4 192.0.2.15", EntityCategory.IP_ADDRESS, "192.0.2.15"),
        ("IPv6 2001:db8::15", EntityCategory.IP_ADDRESS, "2001:db8::15"),
        ("MAC 02:00:5E:10:00:00", EntityCategory.MAC_ADDRESS, "02:00:5E:10:00:00"),
        (
            "Token ghp_0123456789abcdefghijABCDEFGHIJ12",
            EntityCategory.API_KEY,
            "ghp_0123456789abcdefghijABCDEFGHIJ12",
        ),
        ("VIN: SALLBBB29BB123456", EntityCategory.VEHICLE, "SALLBBB29BB123456"),
        ("nr rej. GD4521K", EntityCategory.VEHICLE, "GD4521K"),
        ("adres 81-300 Gdynia", EntityCategory.ADDRESS, "81-300"),
        ("sygn. II PSKP 11/21", EntityCategory.CASE_NUMBER, "II PSKP 11/21"),
        (
            "znak sprawy DOP-1.4131.15.2026",
            EntityCategory.ADMIN_CASE,
            "DOP-1.4131.15.2026",
        ),
        ("GPS 54.3520, 18.6466", EntityCategory.GPS, "54.3520, 18.6466"),
        ("GPS 54°21'07\"N", EntityCategory.GPS, "54°21'07\"N"),
        ("Wynagrodzenie 1 234,56 zł", EntityCategory.MONEY, "1 234,56"),
        ("data urodzenia: 12.03.1985", EntityCategory.DATE, "12.03.1985"),
    ],
)
def test_detects_valid_candidates(text: str, category: EntityCategory, expected_text: str) -> None:
    entities = _only(text, category)

    assert len(entities) == 1
    assert entities[0].text == expected_text
    if category in {
        EntityCategory.PESEL,
        EntityCategory.NIP,
        EntityCategory.REGON,
        EntityCategory.ID_CARD,
        EntityCategory.PASSPORT,
        EntityCategory.BANK_ACCOUNT,
        EntityCategory.PAYMENT_CARD,
        EntityCategory.LAND_REGISTER,
        EntityCategory.IP_ADDRESS,
        EntityCategory.GPS,
    }:
        assert entities[0].validation == ValidationStatus.PASSED
        assert entities[0].confidence == 1.0
    else:
        assert entities[0].validation == ValidationStatus.NOT_APPLICABLE


@pytest.mark.parametrize(
    ("text", "category"),
    [
        (f"PESEL {corrupt_last_digit(generate_pesel())}", EntityCategory.PESEL),
        ("PESEL 99133212345", EntityCategory.PESEL),
        (f"NIP {corrupt_last_digit(generate_nip())}", EntityCategory.NIP),
        (f"REGON {corrupt_last_digit(generate_regon9())}", EntityCategory.REGON),
        (f"REGON {corrupt_last_digit(generate_regon14())}", EntityCategory.REGON),
        (f"Dowod {corrupt_last_digit(generate_id_card())}", EntityCategory.ID_CARD),
        (f"Paszport {corrupt_last_digit(generate_passport())}", EntityCategory.PASSPORT),
        (
            f"Księga wieczysta {corrupt_last_digit(generate_land_register())}",
            EntityCategory.LAND_REGISTER,
        ),
        (f"Rachunek {corrupt_last_digit(generate_nrb())}", EntityCategory.BANK_ACCOUNT),
        (f"IBAN {corrupt_last_digit(generate_iban_pl())}", EntityCategory.BANK_ACCOUNT),
    ],
)
def test_invalid_checksums_are_returned_as_failed(
    text: str, category: EntityCategory
) -> None:
    entities = _only(text, category)

    assert len(entities) == 1
    assert entities[0].validation == ValidationStatus.FAILED
    assert entities[0].confidence == 0.4


@pytest.mark.parametrize(
    ("text", "category", "expected_count"),
    [
        ("(44051401359)", EntityCategory.PESEL, 1),
        ("A44051401359", EntityCategory.PESEL, 0),
        ("44051401359B", EntityCategory.PESEL, 0),
        ("(526-10-40-828)", EntityCategory.NIP, 1),
        ("XABC712345", EntityCategory.ID_CARD, 0),
        ("ABC712345X", EntityCategory.ID_CARD, 0),
        ("poprzednio wpisany numer KRS: 0000123456", EntityCategory.KRS, 1),
        ("numer 0000123456", EntityCategory.KRS, 0),
        ("mail: test@example.com.", EntityCategory.EMAIL, 1),
        ("https://example.com/path).", EntityCategory.URL, 1),
        (f"konto ({format_nrb_groups(generate_nrb())}).", EntityCategory.BANK_ACCOUNT, 1),
        ("16012345678", EntityCategory.PHONE, 0),
        ("identyfikator GD4521K bez pojazdu", EntityCategory.VEHICLE, 0),
        ("SALLBBB29BB123456 bez kontekstu", EntityCategory.VEHICLE, 0),
        ("II PSKP 11/21 bez sygnatury", EntityCategory.CASE_NUMBER, 0),
        ("DOP-1.4131.15.2026 bez etykiety", EntityCategory.ADMIN_CASE, 0),
        ("Kwota 1234,56 bez waluty", EntityCategory.MONEY, 0),
        ("999.0.2.15", EntityCategory.IP_ADDRESS, 0),
        ("02:00:5E:10:00", EntityCategory.MAC_ADDRESS, 0),
        ("sk-short", EntityCategory.API_KEY, 0),
        ("91.0001, 18.6466", EntityCategory.GPS, 0),
    ],
)
def test_boundaries_and_context(
    text: str, category: EntityCategory, expected_count: int
) -> None:
    assert len(_only(text, category)) == expected_count


@pytest.mark.parametrize(
    ("text", "category"),
    [
        ("Numer zamowienia 123456789012 nie jest identyfikatorem.", EntityCategory.PESEL),
        ("Numer zamowienia 123456789012 nie jest identyfikatorem.", EntityCategory.NIP),
        ("Numer zamowienia 123456789012 nie jest identyfikatorem.", EntityCategory.REGON),
        ("To nie jest dowod AABC712345.", EntityCategory.ID_CARD),
        ("KRS bez numeru nie wystarczy.", EntityCategory.KRS),
        ("example.com bez prefiksu nie jest URL-em.", EntityCategory.URL),
        ("abc@localhost bez domeny TLD nie jest adresem e-mail.", EntityCategory.EMAIL),
        ("601234567 bez separatorow pomijamy jako telefon.", EntityCategory.PHONE),
        ("4111 1111 1111 1112 nie przechodzi Luhn.", EntityCategory.PAYMENT_CARD),
    ],
)
def test_common_false_positives_are_not_accepted(
    text: str, category: EntityCategory
) -> None:
    assert _only(text, category) == []


def test_invalid_nip_order_number_is_not_passed() -> None:
    entities = _only("Numer zamowienia 1234563210.", EntityCategory.NIP)

    assert entities
    assert all(entity.validation != ValidationStatus.PASSED for entity in entities)


def test_new_checksum_validators_reject_corrupted_values() -> None:
    assert validate_passport(generate_passport())
    assert not validate_passport(corrupt_last_digit(generate_passport()))
    assert validate_land_register(generate_land_register())
    assert not validate_land_register(corrupt_last_digit(generate_land_register()))
    assert validate_payment_card("4111-1111-1111-1111")
    assert not validate_payment_card("4111-1111-1111-1112")


def test_mistyped_pesel_from_quality_corpus_is_returned_as_failed() -> None:
    entities = _only("W formularzu wpisano PESEL 44051401358.", EntityCategory.PESEL)

    assert len(entities) == 1
    assert entities[0].text == "44051401358"
    assert entities[0].validation == ValidationStatus.FAILED


def test_prompt_example_returns_exactly_pesel_and_nip() -> None:
    entities = detect_deterministic("Jan Kowalski, PESEL 44051401359, NIP 526-10-40-828")

    assert [(entity.category, entity.validation) for entity in entities] == [
        (EntityCategory.PESEL, ValidationStatus.PASSED),
        (EntityCategory.NIP, ValidationStatus.PASSED),
    ]
    assert [entity.text for entity in entities] == ["44051401359", "526-10-40-828"]


def test_longer_bank_account_wins_over_nested_numeric_candidates() -> None:
    nrb = generate_nrb()
    entities = detect_deterministic(f"Rachunek {nrb}")

    assert len(entities) == 1
    assert entities[0].category == EntityCategory.BANK_ACCOUNT
    assert entities[0].text == nrb


def test_contextual_krs_wins_over_same_span_nip_candidate() -> None:
    entities = detect_deterministic("Wpis w rejestrze KRS 5261040828 pozostaje aktywny.")

    assert len(entities) == 1
    assert entities[0].category == EntityCategory.KRS
    assert entities[0].validation == ValidationStatus.NOT_APPLICABLE


def test_identifier_label_does_not_leak_to_neighboring_identifier() -> None:
    entities = detect_deterministic(
        "pod numerem KRS 0000111111, NIP 5252248481, REGON 012345678"
    )

    assert [(entity.text, entity.category) for entity in entities] == [
        ("0000111111", EntityCategory.KRS),
        ("5252248481", EntityCategory.NIP),
        ("012345678", EntityCategory.REGON),
    ]


@pytest.mark.slow
def test_detect_deterministic_processes_one_mb_under_two_seconds() -> None:
    text = ("Lorem ipsum dolor sit amet. " * 40_000)[:1_000_000]
    text += " PESEL 44051401359 NIP 526-10-40-828"

    started = time.perf_counter()
    entities = detect_deterministic(text)
    elapsed = time.perf_counter() - started

    assert elapsed < 2.0
    assert [entity.category for entity in entities[-2:]] == [
        EntityCategory.PESEL,
        EntityCategory.NIP,
    ]
