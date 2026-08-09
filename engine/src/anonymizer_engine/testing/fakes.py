"""Fake Polish identifiers with valid checksums."""

from __future__ import annotations

from datetime import date
from typing import Literal

GrammaticalCase = Literal["nom", "gen", "dat", "inst"]

_LAND_REGISTER_CHAR_VALUES = {
    "X": 10,
    **{chr(code): code - ord("A") + 11 for code in range(ord("A"), ord("P") + 1)},
    **{chr(code): code - ord("A") + 10 for code in range(ord("R"), ord("U") + 1)},
    "W": 31,
    "Y": 32,
    "Z": 33,
}


def _surname(gender: str, nom: str, gen: str, dat: str, inst: str) -> dict[str, str]:
    return {"gender": gender, "nom": nom, "gen": gen, "dat": dat, "inst": inst}

MALE_FIRST_NAME_INFLECTIONS: tuple[dict[str, str], ...] = (
    {"nom": "Jan", "gen": "Jana", "dat": "Janowi", "inst": "Janem"},
    {"nom": "Piotr", "gen": "Piotra", "dat": "Piotrowi", "inst": "Piotrem"},
    {"nom": "Adam", "gen": "Adama", "dat": "Adamowi", "inst": "Adamem"},
    {"nom": "Michał", "gen": "Michała", "dat": "Michałowi", "inst": "Michałem"},
    {"nom": "Tomasz", "gen": "Tomasza", "dat": "Tomaszowi", "inst": "Tomaszem"},
    {"nom": "Paweł", "gen": "Pawła", "dat": "Pawłowi", "inst": "Pawłem"},
    {"nom": "Krzysztof", "gen": "Krzysztofa", "dat": "Krzysztofowi", "inst": "Krzysztofem"},
    {"nom": "Marcin", "gen": "Marcina", "dat": "Marcinowi", "inst": "Marcinem"},
    {"nom": "Andrzej", "gen": "Andrzeja", "dat": "Andrzejowi", "inst": "Andrzejem"},
    {"nom": "Łukasz", "gen": "Łukasza", "dat": "Łukaszowi", "inst": "Łukaszem"},
)

FEMALE_FIRST_NAME_INFLECTIONS: tuple[dict[str, str], ...] = (
    {"nom": "Anna", "gen": "Anny", "dat": "Annie", "inst": "Anną"},
    {"nom": "Maria", "gen": "Marii", "dat": "Marii", "inst": "Marią"},
    {"nom": "Katarzyna", "gen": "Katarzyny", "dat": "Katarzynie", "inst": "Katarzyną"},
    {"nom": "Agnieszka", "gen": "Agnieszki", "dat": "Agnieszce", "inst": "Agnieszką"},
    {"nom": "Małgorzata", "gen": "Małgorzaty", "dat": "Małgorzacie", "inst": "Małgorzatą"},
    {"nom": "Ewa", "gen": "Ewy", "dat": "Ewie", "inst": "Ewą"},
    {"nom": "Joanna", "gen": "Joanny", "dat": "Joannie", "inst": "Joanną"},
    {"nom": "Magdalena", "gen": "Magdaleny", "dat": "Magdalenie", "inst": "Magdaleną"},
    {"nom": "Aleksandra", "gen": "Aleksandry", "dat": "Aleksandrze", "inst": "Aleksandrą"},
    {"nom": "Monika", "gen": "Moniki", "dat": "Monice", "inst": "Moniką"},
)

SURNAME_INFLECTIONS: tuple[dict[str, str], ...] = (
    _surname("m", "Kowalski", "Kowalskiego", "Kowalskiemu", "Kowalskim"),
    _surname("m", "Nowak", "Nowaka", "Nowakowi", "Nowakiem"),
    _surname("m", "Wiśniewski", "Wiśniewskiego", "Wiśniewskiemu", "Wiśniewskim"),
    _surname("m", "Wójcik", "Wójcika", "Wójcikowi", "Wójcikiem"),
    _surname("m", "Kowalczyk", "Kowalczyka", "Kowalczykowi", "Kowalczykiem"),
    _surname("m", "Kamiński", "Kamińskiego", "Kamińskiemu", "Kamińskim"),
    _surname(
        "m",
        "Lewandowski",
        "Lewandowskiego",
        "Lewandowskiemu",
        "Lewandowskim",
    ),
    _surname("m", "Zieliński", "Zielińskiego", "Zielińskiemu", "Zielińskim"),
    _surname("m", "Szymański", "Szymańskiego", "Szymańskiemu", "Szymańskim"),
    _surname("m", "Woźniak", "Woźniaka", "Woźniakowi", "Woźniakiem"),
    _surname("m", "Dąbrowski", "Dąbrowskiego", "Dąbrowskiemu", "Dąbrowskim"),
    _surname("m", "Kozłowski", "Kozłowskiego", "Kozłowskiemu", "Kozłowskim"),
    _surname("m", "Jankowski", "Jankowskiego", "Jankowskiemu", "Jankowskim"),
    _surname("m", "Mazur", "Mazura", "Mazurowi", "Mazurem"),
    _surname("m", "Witkowski", "Witkowskiego", "Witkowskiemu", "Witkowskim"),
    _surname("f", "Kowalska", "Kowalskiej", "Kowalskiej", "Kowalską"),
    _surname("f", "Nowak", "Nowak", "Nowak", "Nowak"),
    _surname("f", "Wiśniewska", "Wiśniewskiej", "Wiśniewskiej", "Wiśniewską"),
    _surname("f", "Wójcik", "Wójcik", "Wójcik", "Wójcik"),
    _surname("f", "Kowalczyk", "Kowalczyk", "Kowalczyk", "Kowalczyk"),
    _surname("f", "Kamińska", "Kamińskiej", "Kamińskiej", "Kamińską"),
    _surname(
        "f",
        "Lewandowska",
        "Lewandowskiej",
        "Lewandowskiej",
        "Lewandowską",
    ),
    _surname("f", "Zielińska", "Zielińskiej", "Zielińskiej", "Zielińską"),
    _surname("f", "Szymańska", "Szymańskiej", "Szymańskiej", "Szymańską"),
    _surname("f", "Woźniak", "Woźniak", "Woźniak", "Woźniak"),
    _surname("f", "Dąbrowska", "Dąbrowskiej", "Dąbrowskiej", "Dąbrowską"),
    _surname("f", "Kozłowska", "Kozłowskiej", "Kozłowskiej", "Kozłowską"),
    _surname("f", "Jankowska", "Jankowskiej", "Jankowskiej", "Jankowską"),
    _surname("f", "Mazur", "Mazur", "Mazur", "Mazur"),
    _surname("f", "Witkowska", "Witkowskiej", "Witkowskiej", "Witkowską"),
)


def inflected_person(index: int, grammatical_case: GrammaticalCase = "nom") -> str:
    surname = SURNAME_INFLECTIONS[index % len(SURNAME_INFLECTIONS)]
    first_names = (
        MALE_FIRST_NAME_INFLECTIONS
        if surname["gender"] == "m"
        else FEMALE_FIRST_NAME_INFLECTIONS
    )
    first_name = first_names[index % len(first_names)]
    return f"{first_name[grammatical_case]} {surname[grammatical_case]}"


def canonical_person(index: int) -> str:
    return inflected_person(index, "nom")


def generate_pesel(birth_date: date = date(1944, 5, 14), serial: str = "0135") -> str:
    encoded_month = _encode_pesel_month(birth_date.year, birth_date.month)
    first_ten = f"{birth_date.year % 100:02d}{encoded_month:02d}{birth_date.day:02d}{serial}"
    weights = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3]
    checksum = (
        10
        - sum(int(digit) * weight for digit, weight in zip(first_ten, weights, strict=True))
        % 10
    ) % 10
    return first_ten + str(checksum)


def generate_nip(first_nine: str = "526104082") -> str:
    weights = [6, 5, 7, 2, 3, 4, 5, 6, 7]
    base = first_nine
    checksum = sum(int(digit) * weight for digit, weight in zip(base, weights, strict=True)) % 11
    if checksum == 10:
        return generate_nip(_increment_digits(base))
    return base + str(checksum)


def generate_regon9(first_eight: str = "12345678") -> str:
    weights = [8, 9, 2, 3, 4, 5, 6, 7]
    checksum = (
        sum(int(digit) * weight for digit, weight in zip(first_eight, weights, strict=True))
        % 11
    )
    checksum = 0 if checksum == 10 else checksum
    return first_eight + str(checksum)


def generate_regon14(first_thirteen: str = "1234567851234") -> str:
    weights = [2, 4, 8, 5, 0, 9, 7, 3, 6, 1, 2, 4, 8]
    checksum = sum(
        int(digit) * weight for digit, weight in zip(first_thirteen, weights, strict=True)
    ) % 11
    checksum = 0 if checksum == 10 else checksum
    return first_thirteen + str(checksum)


def generate_id_card(letters: str = "ABC", suffix: str = "12345") -> str:
    weights = [7, 3, 1, 7, 3, 1, 7, 3, 1]
    letter_values = [_letter_value(char) for char in letters.upper()]
    suffix_values = [int(char) for char in suffix]
    known_sum = (
        sum(value * weight for value, weight in zip(letter_values, weights[:3], strict=True))
        + sum(value * weight for value, weight in zip(suffix_values, weights[4:], strict=True))
    )
    check_digit = (-known_sum * 3) % 10
    return letters.upper() + str(check_digit) + suffix


def generate_passport(series: str = "AB", serial: str = "123456") -> str:
    normalized_series = series.upper()
    if len(normalized_series) != 2 or len(serial) != 6:
        raise ValueError("passport requires two letters and six serial digits")
    weights = [7, 3, 9, 1, 7, 3, 1, 7, 3]
    for check_digit in range(10):
        candidate = normalized_series + str(check_digit) + serial
        values = [_letter_value(char) if char.isalpha() else int(char) for char in candidate]
        if sum(value * weight for value, weight in zip(values, weights, strict=True)) % 10 == 0:
            return candidate
    raise AssertionError("passport checksum digit not found")


def generate_land_register(court_code: str = "GD1G", number: str = "00012345") -> str:
    normalized_code = court_code.upper()
    if len(normalized_code) != 4 or len(number) != 8:
        raise ValueError("land register requires a four-character court code and eight digits")
    base = normalized_code + number
    values = [
        int(char) if char.isdigit() else _LAND_REGISTER_CHAR_VALUES[char]
        for char in base
    ]
    checksum = sum(
        value * weight
        for value, weight in zip(values, [1, 3, 7] * 4, strict=True)
    ) % 10
    return f"{normalized_code}/{number}/{checksum}"


def generate_nrb(bban: str = "101000712222222222222222") -> str:
    check_digits = _iban_check_digits("PL", bban)
    return check_digits + bban


def generate_iban_pl(bban: str = "101000712222222222222222") -> str:
    return "PL" + generate_nrb(bban)


def corrupt_last_digit(value: str) -> str:
    for index in range(len(value) - 1, -1, -1):
        if value[index].isdigit():
            replacement = "0" if value[index] != "0" else "1"
            return value[:index] + replacement + value[index + 1 :]
    raise ValueError("value has no digit to corrupt")


def format_nrb_groups(nrb: str) -> str:
    return nrb[:2] + " " + " ".join(nrb[index : index + 4] for index in range(2, 26, 4))


def _encode_pesel_month(year: int, month: int) -> int:
    if 1800 <= year <= 1899:
        return month + 80
    if 1900 <= year <= 1999:
        return month
    if 2000 <= year <= 2099:
        return month + 20
    if 2100 <= year <= 2199:
        return month + 40
    if 2200 <= year <= 2299:
        return month + 60
    raise ValueError("PESEL supports dates from 1800 to 2299")


def _iban_check_digits(country_code: str, bban: str) -> str:
    rearranged = bban + country_code.upper() + "00"
    numeric = "".join(str(ord(char) - 55) if char.isalpha() else char for char in rearranged)
    return f"{98 - int(numeric) % 97:02d}"


def _letter_value(char: str) -> int:
    return ord(char) - ord("A") + 10


def _increment_digits(value: str) -> str:
    return f"{int(value) + 1:0{len(value)}d}"[-len(value) :]
