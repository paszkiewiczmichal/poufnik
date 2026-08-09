"""Deterministic Polish PII recognizers."""

from __future__ import annotations

import ipaddress
import re
import time
from collections.abc import Callable, Iterable
from datetime import date

import regex as regex_module

from anonymizer_engine.detection.models import (
    DetectedEntity,
    EntityCategory,
    ValidationStatus,
)

# Hard wall-clock budget for evaluating ALL user-supplied custom rules on a single
# document. The `regex` engine (unlike stdlib `re`) honours this deadline and raises
# TimeoutError instead of backtracking indefinitely, which is the real defence against
# ReDoS in user-authored patterns; the nested-quantifier heuristic below is only a cheap
# pre-filter and does not catch every catastrophic shape (e.g. ``(a|a)*b``).
CUSTOM_RULE_TIMEOUT_SECONDS = 2.0

_PESEL_RE = re.compile(r"\d{11}")
_NIP_RE = re.compile(
    r"(?:PL[\s-]?)?(?:\d{3}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}"
    r"|\d{3}[\s-]?\d{2}[\s-]?\d{2}[\s-]?\d{3}|\d{10})",
    re.IGNORECASE,
)
_REGON_RE = re.compile(r"\d{14}|\d{9}")
_ID_CARD_RE = re.compile(r"[A-Z]{3}[\s-]?\d{6}", re.IGNORECASE)
_PASSPORT_RE = re.compile(r"\b[A-Z]{2}\d{7}\b", re.IGNORECASE)
_KRS_RE = re.compile(r"\d{10}")
_BANK_ACCOUNT_RE = re.compile(r"(?:PL[\s-]?)?\d{2}(?:[\s-]?\d{4}){6}", re.IGNORECASE)
_PAYMENT_CARD_RE = re.compile(r"(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)")
_LAND_REGISTER_RE = re.compile(r"\b[A-Z]{2}\d[A-Z]/\d{8}/\d\b", re.IGNORECASE)
_PHONE_RE = re.compile(
    r"(?:\+48[\s-]?)?(?:\d{3}[\s-]\d{3}[\s-]\d{3}"
    r"|\(\d{2}\)[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2})"
)
_EMAIL_RE = re.compile(
    r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,24}",
    re.IGNORECASE,
)
_URL_RE = re.compile(r"(?:https?://|www\.)[^\s<>\"]+", re.IGNORECASE)
_IPV4_RE = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")
_IPV6_RE = re.compile(
    r"(?<![0-9A-F:])(?:[0-9A-F]{0,4}:){2,7}[0-9A-F]{0,4}(?![0-9A-F:])",
    re.IGNORECASE,
)
_MAC_ADDRESS_RE = re.compile(r"\b(?:[0-9A-F]{2}[:-]){5}[0-9A-F]{2}\b", re.IGNORECASE)
_API_KEY_RE = re.compile(
    r"(?:\bsk-[A-Z0-9_-]{20,}"
    r"|\bgh(?:p|o)_[A-Z0-9]{20,}"
    r"|\bgithub_pat_[A-Z0-9_]{20,}"
    r"|\bAKIA[0-9A-Z]{16}\b"
    r"|\bxoxb-[A-Z0-9-]{20,}"
    r"|\bBearer\s+[A-Z0-9._~+/=-]{20,}"
    r"|\bAWS4-[A-Z0-9_./+=-]{20,})",
    re.IGNORECASE,
)
_POSTAL_CODE_RE = re.compile(r"\b\d{2}-\d{3}\b")
_VIN_RE = re.compile(r"\b[A-HJ-NPR-Z0-9]{17}\b", re.IGNORECASE)
_PLATE_RE = re.compile(r"\b[A-ZĄĆĘŁŃÓŚŹŻ]{2,3}[A-Z0-9]{4,5}\b")
_CASE_NUMBER_RE = re.compile(r"\b[IVXLCDM]{1,8}\s+[A-Z]{1,4}\s+\d+/\d{2,4}\b")
_ADMIN_CASE_RE = re.compile(
    r"\b[A-ZĄĆĘŁŃÓŚŹŻ]{2,}(?:-[A-Z0-9]+)?(?:[./][A-Z0-9-]+){2,}\b",
    re.IGNORECASE,
)
_DECIMAL_GPS_RE = re.compile(
    r"(?<![\d.,])([+-]?\d{1,2}[.,]\d+)\s*([NS])?\s*[,;]\s*"
    r"([+-]?\d{1,3}[.,]\d+)\s*([EW])?(?![\d.,])",
    re.IGNORECASE,
)
_DMS_GPS_RE = re.compile(
    r"(?<!\w)(\d{1,3})\s*°\s*(\d{1,2})\s*['′]\s*"
    r"(\d{1,2}(?:[.,]\d+)?)\s*(?:[\"″]\s*)?([NSEW])(?!\w)",
    re.IGNORECASE,
)
_MONEY_RE = re.compile(
    r"(?<![\d.,])(?:\d{1,3}(?:[ .]\d{3})+|\d+)(?:,\d{2})?(?![\d.,])"
)
_BIRTH_DATE_RE = re.compile(
    r"\b(?:\d{1,2}[.-]\d{1,2}[.-]\d{4}|\d{4}-\d{2}-\d{2}|"
    r"\d{1,2}\s+(?:stycznia|lutego|marca|kwietnia|maja|czerwca|lipca|sierpnia|"
    r"września|października|listopada|grudnia)\s+\d{4}(?:\s*r\.?)?)\b",
    re.IGNORECASE,
)
_NESTED_QUANTIFIER_RE = re.compile(r"\((?:[^()\\]|\\.)*[+*](?:[^()\\]|\\.)*\)\s*(?:[+*?]|\{\d)")
_VEHICLE_CONTEXT_RE = re.compile(
    r"\b(?:VIN|nr\s+rej\.?|numer\s+rejestracyjny|rejestracyjny|tablic[aeąy]?|pojazd|"
    r"samochód|samochodu|auto|marki|nadwozia)\b",
    re.IGNORECASE,
)
_CASE_NUMBER_CONTEXT_RE = re.compile(r"\b(?:sygn\.?|sygnatura|sprawa)\b", re.IGNORECASE)
_PASSPORT_CONTEXT_RE = re.compile(r"\b(?:paszport|passport)\b", re.IGNORECASE)
_ADMIN_CASE_CONTEXT_RE = re.compile(
    r"(?:znak\s+sprawy|sygn\.?|nr\s+decyzji|decyzja\s+nr|"
    r"postanowienie\s+nr|zawiadomienie\s+nr)",
    re.IGNORECASE,
)
_CURRENCY_RE = re.compile(r"(?:\bzł\b|\bPLN\b|\bEUR\b|€|\bUSD\b|\$|\bCHF\b|\bGBP\b)", re.IGNORECASE)
_BIRTH_DATE_CONTEXT_RE = re.compile(
    r"(?:\bdata\s+urodzenia\b|\bur\.?|\burodzon[ay]\b)",
    re.IGNORECASE,
)
_IDENTIFIER_LABEL_RE = re.compile(r"\b(?:PESEL|NIP|REGON|KRS)\b", re.IGNORECASE)

_LAND_REGISTER_CHAR_VALUES = {
    "X": 10,
    **{chr(code): code - ord("A") + 11 for code in range(ord("A"), ord("P") + 1)},
    **{chr(code): code - ord("A") + 10 for code in range(ord("R"), ord("U") + 1)},
    "W": 31,
    "Y": 32,
    "Z": 33,
}

_CATEGORY_PRIORITY = {
    EntityCategory.BANK_ACCOUNT: 90,
    EntityCategory.PAYMENT_CARD: 88,
    EntityCategory.LAND_REGISTER: 87,
    EntityCategory.KRS: 85,
    EntityCategory.ID_CARD: 80,
    EntityCategory.PASSPORT: 78,
    EntityCategory.PESEL: 75,
    EntityCategory.NIP: 70,
    EntityCategory.REGON: 65,
    EntityCategory.EMAIL: 60,
    EntityCategory.URL: 55,
    EntityCategory.API_KEY: 54,
    EntityCategory.IP_ADDRESS: 53,
    EntityCategory.MAC_ADDRESS: 52,
    EntityCategory.PHONE: 50,
    EntityCategory.VEHICLE: 45,
    EntityCategory.CASE_NUMBER: 40,
    EntityCategory.ADMIN_CASE: 39,
    EntityCategory.GPS: 37,
    EntityCategory.MONEY: 36,
    EntityCategory.DATE: 35,
    EntityCategory.ADDRESS: 35,
}


def detect_deterministic(text: str) -> list[DetectedEntity]:
    """Detect deterministic Polish sensitive-data candidates in text."""
    entities: list[DetectedEntity] = []
    recognizers: list[Callable[[str], Iterable[DetectedEntity]]] = [
        _detect_bank_accounts,
        _detect_payment_cards,
        _detect_land_registers,
        _detect_id_cards,
        _detect_passports,
        _detect_krs,
        _detect_pesel,
        _detect_nip,
        _detect_regon,
        _detect_email,
        _detect_url,
        _detect_api_keys,
        _detect_ip_addresses,
        _detect_mac_addresses,
        _detect_phone,
        _detect_vehicles,
        _detect_case_numbers,
        _detect_admin_cases,
        _detect_gps,
        _detect_money,
        _detect_birth_dates,
        _detect_postal_codes,
    ]
    for recognizer in recognizers:
        entities.extend(recognizer(text))
    return _dedupe_overlaps(entities)


def detect_custom_rules(
    text: str,
    custom_rules: list[dict[str, object]] | None,
    *,
    timeout_seconds: float = CUSTOM_RULE_TIMEOUT_SECONDS,
) -> list[DetectedEntity]:
    """Detect local user-defined custom regex rules under a hard time budget.

    Every user pattern runs on the `regex` engine with a wall-clock ``timeout`` shared
    across all rules for one document. A catastrophic-backtracking pattern raises
    ``ValueError`` (surfaced as HTTP 400) instead of hanging the process.
    """
    entities: list[DetectedEntity] = []
    deadline = time.monotonic() + timeout_seconds
    for index, rule in enumerate(custom_rules or []):
        pattern = rule.get("pattern") or rule.get("regex")
        if not isinstance(pattern, str) or not pattern:
            continue
        if regex_has_catastrophic_backtracking_risk(pattern):
            msg = f"custom_rules[{index}] pattern has nested quantifiers"
            raise ValueError(msg)
        label = rule.get("label") or rule.get("name") or f"CUSTOM_{index + 1}"
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            msg = f"custom_rules[{index}] evaluation exceeded the {timeout_seconds}s time budget"
            raise ValueError(msg)
        try:
            compiled = regex_module.compile(pattern)
            matches = list(compiled.finditer(text, timeout=remaining))
        except TimeoutError as exc:
            msg = (
                f"custom_rules[{index}] pattern is too slow to evaluate "
                f"(exceeded {timeout_seconds}s); simplify the pattern"
            )
            raise ValueError(msg) from exc
        except regex_module.error as exc:
            msg = f"custom_rules[{index}] pattern is invalid: {exc}"
            raise ValueError(msg) from exc
        for match in matches:
            if match.end() <= match.start():
                continue
            value = text[match.start() : match.end()]
            entities.append(
                DetectedEntity(
                    category=EntityCategory.CUSTOM,
                    start=match.start(),
                    end=match.end(),
                    text=value,
                    confidence=1.0,
                    source="regex",
                    validation=ValidationStatus.NOT_APPLICABLE,
                    entity_group_id=f"custom:{label}:{value}",
                    canonical_text=value,
                )
            )
    return _dedupe_custom_overlaps(entities)


def regex_has_catastrophic_backtracking_risk(pattern: str) -> bool:
    """Reject the common nested-quantifier shape that can stall Python's backtracking regex.

    This is only a cheap pre-filter; the authoritative ReDoS defence is the wall-clock
    ``timeout`` applied when the pattern is actually evaluated in :func:`detect_custom_rules`.
    """
    return bool(_NESTED_QUANTIFIER_RE.search(pattern))


def _detect_pesel(text: str) -> Iterable[DetectedEntity]:
    for match in _PESEL_RE.finditer(text):
        if not _has_alnum_boundaries(text, match.start(), match.end()):
            continue
        validation = _passed_or_failed(validate_pesel(match.group()))
        yield _entity(EntityCategory.PESEL, match.start(), match.end(), text, validation)


def _detect_nip(text: str) -> Iterable[DetectedEntity]:
    for match in _NIP_RE.finditer(text):
        if not _has_alnum_boundaries(text, match.start(), match.end()):
            continue
        if _has_conflicting_identifier_label(text, match.start(), "NIP"):
            continue
        digits = _digits(match.group())
        if len(digits) != 10:
            continue
        validation = _passed_or_failed(validate_nip(match.group()))
        yield _entity(EntityCategory.NIP, match.start(), match.end(), text, validation)


def _detect_regon(text: str) -> Iterable[DetectedEntity]:
    for match in _REGON_RE.finditer(text):
        if not _has_alnum_boundaries(text, match.start(), match.end()):
            continue
        if _has_conflicting_identifier_label(text, match.start(), "REGON"):
            continue
        validation = _passed_or_failed(validate_regon(match.group()))
        yield _entity(EntityCategory.REGON, match.start(), match.end(), text, validation)


def _detect_id_cards(text: str) -> Iterable[DetectedEntity]:
    for match in _ID_CARD_RE.finditer(text):
        if not _has_alnum_boundaries(text, match.start(), match.end()):
            continue
        validation = _passed_or_failed(validate_id_card(match.group()))
        yield _entity(EntityCategory.ID_CARD, match.start(), match.end(), text, validation)


def _detect_passports(text: str) -> Iterable[DetectedEntity]:
    for match in _PASSPORT_RE.finditer(text):
        if not _has_alnum_boundaries(text, match.start(), match.end()):
            continue
        is_valid = validate_passport(match.group())
        if not is_valid and not _context_near(
            text, match.start(), match.end(), _PASSPORT_CONTEXT_RE, radius=35
        ):
            continue
        yield _entity(
            EntityCategory.PASSPORT,
            match.start(),
            match.end(),
            text,
            _passed_or_failed(is_valid),
        )


def _detect_krs(text: str) -> Iterable[DetectedEntity]:
    for match in _KRS_RE.finditer(text):
        if not _has_alnum_boundaries(text, match.start(), match.end()):
            continue
        label = _nearest_identifier_label_before(text, match.start())
        if label != "KRS":
            continue
        yield _entity(
            EntityCategory.KRS,
            match.start(),
            match.end(),
            text,
            ValidationStatus.NOT_APPLICABLE,
        )


def _detect_bank_accounts(text: str) -> Iterable[DetectedEntity]:
    for match in _BANK_ACCOUNT_RE.finditer(text):
        if not _has_alnum_boundaries(text, match.start(), match.end()):
            continue
        validation = _passed_or_failed(validate_bank_account(match.group()))
        yield _entity(EntityCategory.BANK_ACCOUNT, match.start(), match.end(), text, validation)


def _detect_payment_cards(text: str) -> Iterable[DetectedEntity]:
    for match in _PAYMENT_CARD_RE.finditer(text):
        if not validate_payment_card(match.group()):
            continue
        yield _entity(
            EntityCategory.PAYMENT_CARD,
            match.start(),
            match.end(),
            text,
            ValidationStatus.PASSED,
        )


def _detect_land_registers(text: str) -> Iterable[DetectedEntity]:
    for match in _LAND_REGISTER_RE.finditer(text):
        yield _entity(
            EntityCategory.LAND_REGISTER,
            match.start(),
            match.end(),
            text,
            _passed_or_failed(validate_land_register(match.group())),
        )


def _detect_phone(text: str) -> Iterable[DetectedEntity]:
    for match in _PHONE_RE.finditer(text):
        if not _has_digit_boundaries(text, match.start(), match.end()):
            continue
        digits = _digits(match.group())
        if len(digits) == 11 and digits.startswith("48"):
            digits = digits[2:]
        if len(digits) != 9:
            continue
        yield _entity(
            EntityCategory.PHONE,
            match.start(),
            match.end(),
            text,
            ValidationStatus.NOT_APPLICABLE,
            confidence=0.85,
        )


def _detect_email(text: str) -> Iterable[DetectedEntity]:
    for match in _EMAIL_RE.finditer(text):
        if not _has_email_boundaries(text, match.start(), match.end()):
            continue
        yield _entity(
            EntityCategory.EMAIL,
            match.start(),
            match.end(),
            text,
            ValidationStatus.NOT_APPLICABLE,
            confidence=0.95,
        )


def _detect_url(text: str) -> Iterable[DetectedEntity]:
    for match in _URL_RE.finditer(text):
        start = match.start()
        end = _trim_url_end(text, match.start(), match.end())
        if end <= start or not _has_url_boundaries(text, start, end):
            continue
        yield _entity(
            EntityCategory.URL,
            start,
            end,
            text,
            ValidationStatus.NOT_APPLICABLE,
            confidence=0.95,
        )


def _detect_api_keys(text: str) -> Iterable[DetectedEntity]:
    for match in _API_KEY_RE.finditer(text):
        end = _trim_secret_end(text, match.start(), match.end())
        if end <= match.start():
            continue
        yield _entity(
            EntityCategory.API_KEY,
            match.start(),
            end,
            text,
            ValidationStatus.NOT_APPLICABLE,
            confidence=0.99,
        )


def _detect_ip_addresses(text: str) -> Iterable[DetectedEntity]:
    for pattern in (_IPV4_RE, _IPV6_RE):
        for match in pattern.finditer(text):
            try:
                ipaddress.ip_address(match.group())
            except ValueError:
                continue
            yield _entity(
                EntityCategory.IP_ADDRESS,
                match.start(),
                match.end(),
                text,
                ValidationStatus.PASSED,
            )


def _detect_mac_addresses(text: str) -> Iterable[DetectedEntity]:
    for match in _MAC_ADDRESS_RE.finditer(text):
        yield _entity(
            EntityCategory.MAC_ADDRESS,
            match.start(),
            match.end(),
            text,
            ValidationStatus.NOT_APPLICABLE,
            confidence=0.98,
        )


def _detect_vehicles(text: str) -> Iterable[DetectedEntity]:
    for match in _VIN_RE.finditer(text):
        if not _has_alnum_boundaries(text, match.start(), match.end()):
            continue
        if not _vehicle_context_near(text, match.start(), match.end(), radius=40):
            continue
        yield _entity(
            EntityCategory.VEHICLE,
            match.start(),
            match.end(),
            text,
            ValidationStatus.NOT_APPLICABLE,
            confidence=0.92,
        )

    for match in _PLATE_RE.finditer(text):
        if not _has_alnum_boundaries(text, match.start(), match.end()):
            continue
        if not _vehicle_context_near(text, match.start(), match.end(), radius=40):
            continue
        yield _entity(
            EntityCategory.VEHICLE,
            match.start(),
            match.end(),
            text,
            ValidationStatus.NOT_APPLICABLE,
            confidence=0.85,
        )


def _detect_case_numbers(text: str) -> Iterable[DetectedEntity]:
    for match in _CASE_NUMBER_RE.finditer(text):
        if not _has_alnum_boundaries(text, match.start(), match.end()):
            continue
        context = text[max(0, match.start() - 35) : match.start()]
        if not _CASE_NUMBER_CONTEXT_RE.search(context):
            continue
        yield _entity(
            EntityCategory.CASE_NUMBER,
            match.start(),
            match.end(),
            text,
            ValidationStatus.NOT_APPLICABLE,
            confidence=0.9,
        )


def _detect_admin_cases(text: str) -> Iterable[DetectedEntity]:
    for match in _ADMIN_CASE_RE.finditer(text):
        if not _context_near(
            text, match.start(), match.end(), _ADMIN_CASE_CONTEXT_RE, radius=45
        ):
            continue
        yield _entity(
            EntityCategory.ADMIN_CASE,
            match.start(),
            match.end(),
            text,
            ValidationStatus.NOT_APPLICABLE,
            confidence=0.92,
        )


def _detect_gps(text: str) -> Iterable[DetectedEntity]:
    for match in _DECIMAL_GPS_RE.finditer(text):
        latitude = _decimal_number(match.group(1))
        longitude = _decimal_number(match.group(3))
        if not _coordinate_is_valid(latitude, match.group(2), latitude=True):
            continue
        if not _coordinate_is_valid(longitude, match.group(4), latitude=False):
            continue
        end = match.end()
        while end > match.start() and text[end - 1].isspace():
            end -= 1
        yield _entity(
            EntityCategory.GPS,
            match.start(),
            end,
            text,
            ValidationStatus.PASSED,
        )

    for match in _DMS_GPS_RE.finditer(text):
        degrees = int(match.group(1))
        minutes = int(match.group(2))
        seconds = _decimal_number(match.group(3))
        direction = match.group(4).upper()
        maximum = 90 if direction in {"N", "S"} else 180
        if degrees > maximum or minutes >= 60 or seconds >= 60:
            continue
        if degrees == maximum and (minutes != 0 or seconds != 0):
            continue
        yield _entity(
            EntityCategory.GPS,
            match.start(),
            match.end(),
            text,
            ValidationStatus.PASSED,
        )


def _detect_money(text: str) -> Iterable[DetectedEntity]:
    for match in _MONEY_RE.finditer(text):
        if not _context_near(text, match.start(), match.end(), _CURRENCY_RE, radius=10):
            continue
        yield _entity(
            EntityCategory.MONEY,
            match.start(),
            match.end(),
            text,
            ValidationStatus.NOT_APPLICABLE,
            confidence=0.9,
        )


def _detect_birth_dates(text: str) -> Iterable[DetectedEntity]:
    for match in _BIRTH_DATE_RE.finditer(text):
        if not _context_near(
            text, match.start(), match.end(), _BIRTH_DATE_CONTEXT_RE, radius=25
        ):
            continue
        yield _entity(
            EntityCategory.DATE,
            match.start(),
            match.end(),
            text,
            ValidationStatus.NOT_APPLICABLE,
            confidence=0.98,
        )


def _detect_postal_codes(text: str) -> Iterable[DetectedEntity]:
    for match in _POSTAL_CODE_RE.finditer(text):
        if not _postal_code_context_near(text, match.start(), match.end()):
            continue
        yield _entity(
            EntityCategory.ADDRESS,
            match.start(),
            match.end(),
            text,
            ValidationStatus.NOT_APPLICABLE,
            confidence=0.82,
        )


def _vehicle_context_near(text: str, start: int, end: int, radius: int) -> bool:
    context = text[max(0, start - radius) : min(len(text), end + radius)]
    return bool(_VEHICLE_CONTEXT_RE.search(context))


def _postal_code_context_near(text: str, start: int, end: int) -> bool:
    before = text[max(0, start - 30) : start]
    after = text[end : min(len(text), end + 30)]
    return bool(
        re.search(
            r"(?:\b(?:w|we|z|do|dla|siedzibą|zam\.?|adres|ul\.?|ulicy|miasto|miejscowość)\b"
            r"|[A-ZĄĆĘŁŃÓŚŹŻ][\wąćęłńóśźżĄĆĘŁŃÓŚŹŻ.-]+[\s(,]*)$",
            before,
            re.IGNORECASE,
        )
        or re.search(
            r"^\s*[\),;:-]*\s*(?:ul\.?|ulicy|al\.?|alei|pl\.?|placu|"
            r"[A-ZĄĆĘŁŃÓŚŹŻ][\wąćęłńóśźżĄĆĘŁŃÓŚŹŻ.-]+)",
            after,
        )
    )


def _nearest_identifier_label_before(text: str, start: int, radius: int = 18) -> str | None:
    context = text[max(0, start - radius) : start]
    matches = list(_IDENTIFIER_LABEL_RE.finditer(context))
    if not matches:
        return None
    return matches[-1].group().upper()


def _has_conflicting_identifier_label(text: str, start: int, expected: str) -> bool:
    label = _nearest_identifier_label_before(text, start)
    return label is not None and label != expected


def _context_near(
    text: str,
    start: int,
    end: int,
    pattern: re.Pattern[str],
    *,
    radius: int,
) -> bool:
    context = text[max(0, start - radius) : min(len(text), end + radius)]
    relative_start = start - max(0, start - radius)
    relative_end = relative_start + (end - start)
    context_without_value = context[:relative_start] + " " + context[relative_end:]
    return bool(pattern.search(context_without_value))


def _decimal_number(value: str) -> float:
    return float(value.replace(",", "."))


def _coordinate_is_valid(value: float, direction: str | None, *, latitude: bool) -> bool:
    if direction:
        valid_directions = {"N", "S"} if latitude else {"E", "W"}
        if direction.upper() not in valid_directions:
            return False
    maximum = 90 if latitude else 180
    return -maximum <= value <= maximum


def validate_pesel(value: str) -> bool:
    digits = _digits(value)
    if len(digits) != 11:
        return False
    if not _pesel_birth_date_is_valid(digits[:6]):
        return False
    weights = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3]
    checksum = (10 - sum(int(d) * w for d, w in zip(digits[:10], weights, strict=True)) % 10) % 10
    return checksum == int(digits[-1])


def validate_nip(value: str) -> bool:
    digits = _digits(value)
    if len(digits) != 10:
        return False
    weights = [6, 5, 7, 2, 3, 4, 5, 6, 7]
    checksum = sum(int(d) * w for d, w in zip(digits[:9], weights, strict=True)) % 11
    return checksum != 10 and checksum == int(digits[-1])


def validate_regon(value: str) -> bool:
    digits = _digits(value)
    if len(digits) == 9:
        weights = [8, 9, 2, 3, 4, 5, 6, 7]
        checksum = sum(int(d) * w for d, w in zip(digits[:8], weights, strict=True)) % 11
        checksum = 0 if checksum == 10 else checksum
        return checksum == int(digits[-1])
    if len(digits) == 14:
        weights = [2, 4, 8, 5, 0, 9, 7, 3, 6, 1, 2, 4, 8]
        checksum = sum(int(d) * w for d, w in zip(digits[:13], weights, strict=True)) % 11
        checksum = 0 if checksum == 10 else checksum
        return checksum == int(digits[-1])
    return False


def validate_id_card(value: str) -> bool:
    normalized = re.sub(r"[\s-]", "", value).upper()
    if not re.fullmatch(r"[A-Z]{3}\d{6}", normalized):
        return False
    weights = [7, 3, 1, 7, 3, 1, 7, 3, 1]
    values = [
        _letter_value(char) if index < 3 else int(char)
        for index, char in enumerate(normalized)
    ]
    return sum(value * weight for value, weight in zip(values, weights, strict=True)) % 10 == 0


def validate_passport(value: str) -> bool:
    normalized = value.upper()
    if not re.fullmatch(r"[A-Z]{2}\d{7}", normalized):
        return False
    values = [_letter_value(char) if char.isalpha() else int(char) for char in normalized]
    weights = [7, 3, 9, 1, 7, 3, 1, 7, 3]
    return sum(item * weight for item, weight in zip(values, weights, strict=True)) % 10 == 0


def validate_payment_card(value: str) -> bool:
    digits = _digits(value)
    if not 13 <= len(digits) <= 19 or len(set(digits)) == 1:
        return False
    checksum = 0
    parity = len(digits) % 2
    for index, char in enumerate(digits):
        digit = int(char)
        if index % 2 == parity:
            digit *= 2
            if digit > 9:
                digit -= 9
        checksum += digit
    return checksum % 10 == 0


def validate_land_register(value: str) -> bool:
    normalized = value.replace("/", "").upper()
    if not re.fullmatch(r"[A-Z]{2}\d[A-Z]\d{9}", normalized):
        return False
    values: list[int] = []
    for char in normalized[:-1]:
        if char.isdigit():
            values.append(int(char))
            continue
        mapped = _LAND_REGISTER_CHAR_VALUES.get(char)
        if mapped is None:
            return False
        values.append(mapped)
    weights = [1, 3, 7] * 4
    checksum = sum(item * weight for item, weight in zip(values, weights, strict=True)) % 10
    return checksum == int(normalized[-1])


def validate_bank_account(value: str) -> bool:
    normalized = re.sub(r"[\s-]", "", value).upper()
    if re.fullmatch(r"\d{26}", normalized):
        normalized = "PL" + normalized
    if not re.fullmatch(r"PL\d{26}", normalized):
        return False
    rearranged = normalized[4:] + normalized[:4]
    numeric = "".join(str(ord(char) - 55) if char.isalpha() else char for char in rearranged)
    return int(numeric) % 97 == 1


def _pesel_birth_date_is_valid(value: str) -> bool:
    year = int(value[:2])
    encoded_month = int(value[2:4])
    day = int(value[4:6])
    century_offsets = {
        0: 1900,
        20: 2000,
        40: 2100,
        60: 2200,
        80: 1800,
    }
    for month_offset, century in century_offsets.items():
        month = encoded_month - month_offset
        if 1 <= month <= 12:
            try:
                date(century + year, month, day)
            except ValueError:
                return False
            return True
    return False


def _letter_value(char: str) -> int:
    return ord(char) - ord("A") + 10


def _entity(
    category: EntityCategory,
    start: int,
    end: int,
    text: str,
    validation: ValidationStatus,
    confidence: float | None = None,
) -> DetectedEntity:
    if confidence is None:
        confidence = 1.0 if validation is ValidationStatus.PASSED else 0.4
        if validation is ValidationStatus.NOT_APPLICABLE:
            confidence = 0.9
    return DetectedEntity(
        category=category,
        start=start,
        end=end,
        text=text[start:end],
        confidence=confidence,
        validation=validation,
    )


def _passed_or_failed(is_valid: bool) -> ValidationStatus:
    return ValidationStatus.PASSED if is_valid else ValidationStatus.FAILED


def _digits(value: str) -> str:
    return re.sub(r"\D", "", value)


def _has_alnum_boundaries(text: str, start: int, end: int) -> bool:
    return _is_left_boundary(text, start, str.isalnum) and _is_right_boundary(
        text, end, str.isalnum
    )


def _has_digit_boundaries(text: str, start: int, end: int) -> bool:
    return _is_left_boundary(text, start, str.isdigit) and _is_right_boundary(
        text, end, str.isdigit
    )


def _has_email_boundaries(text: str, start: int, end: int) -> bool:
    email_chars = set("._%+-")
    right_email_chars = set("_%+-")
    return _is_left_boundary(
        text, start, lambda char: char.isalnum() or char in email_chars
    ) and _is_right_boundary(
        text, end, lambda char: char.isalnum() or char in right_email_chars
    )


def _has_url_boundaries(text: str, start: int, end: int) -> bool:
    return _is_left_boundary(text, start, str.isalnum) and _is_right_boundary(
        text, end, lambda char: char.isalnum() or char in "/#?=&%"
    )


def _is_left_boundary(text: str, start: int, predicate: Callable[[str], bool]) -> bool:
    return start == 0 or not predicate(text[start - 1])


def _is_right_boundary(text: str, end: int, predicate: Callable[[str], bool]) -> bool:
    return end == len(text) or not predicate(text[end])


def _trim_url_end(text: str, _start: int, end: int) -> int:
    while end > 0 and text[end - 1] in ".,;:!?)])}":
        end -= 1
    return end


def _trim_secret_end(text: str, _start: int, end: int) -> int:
    while end > 0 and text[end - 1] in ".,;:!?)]}":
        end -= 1
    return end


def _dedupe_overlaps(entities: list[DetectedEntity]) -> list[DetectedEntity]:
    selected: list[DetectedEntity] = []
    for entity in sorted(
        entities,
        key=lambda item: (
            -(item.end - item.start),
            -_CATEGORY_PRIORITY[item.category],
            -item.confidence,
            item.start,
        ),
    ):
        if any(_overlaps(entity, existing) for existing in selected):
            continue
        selected.append(entity)
    return sorted(selected, key=lambda item: (item.start, item.end))


def _dedupe_custom_overlaps(entities: list[DetectedEntity]) -> list[DetectedEntity]:
    selected: list[DetectedEntity] = []
    for entity in sorted(entities, key=lambda item: (-(item.end - item.start), item.start)):
        if any(_overlaps(entity, existing) for existing in selected):
            continue
        selected.append(entity)
    return sorted(selected, key=lambda item: (item.start, item.end))


def _overlaps(left: DetectedEntity, right: DetectedEntity) -> bool:
    return left.start < right.end and right.start < left.end
