from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

from anonymizer_engine.detection.models import EntityCategory
from anonymizer_engine.testing.fakes import (
    format_nrb_groups,
    generate_id_card,
    generate_land_register,
    generate_nip,
    generate_nrb,
    generate_passport,
    generate_pesel,
    generate_regon9,
    inflected_person,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUTPUT = REPO_ROOT / "corpus" / "detection_eval.jsonl"


@dataclass
class DocumentBuilder:
    doc_id: str
    parts: list[str] = field(default_factory=list)
    entities: list[dict[str, object]] = field(default_factory=list)

    @property
    def text(self) -> str:
        return "".join(self.parts)

    def add(self, value: str, category: EntityCategory | None = None) -> None:
        start = len(self.text)
        self.parts.append(value)
        if category is not None:
            self.entities.append(
                {
                    "start": start,
                    "end": start + len(value),
                    "category": category.value,
                }
            )

    def record(self) -> dict[str, object]:
        return {"id": self.doc_id, "text": self.text, "entities": self.entities}


COMPANIES = (
    "Alfa Projekt sp. z o.o.",
    "Beta Handel S.A.",
    "Gamma Logistyka sp.k.",
    "Delta Finanse sp. z o.o.",
    "Epsilon Medica S.A.",
    "Fikcyjna Energia sp. z o.o.",
    "Horyzont Kadry sp.k.",
    "Lumen Software sp. z o.o.",
)
ADDRESSES = (
    ("Gdańsku", "ul. Długiej 5"),
    ("Warszawie", "ul. Prostej 12"),
    ("Krakowie", "ul. Brackiej 7"),
    ("Poznaniu", "ul. Wierzbowej 3"),
    ("Wrocławiu", "ul. Słonecznej 18"),
    ("Łodzi", "ul. Piotrkowskiej 44"),
    ("Szczecinie", "al. Niepodległości 9"),
    ("Lublinie", "ul. Lipowej 21"),
)
DOCUMENT_TYPES = (
    "umowa sprzedaży",
    "umowa o pracę",
    "pozew",
    "wezwanie do zapłaty",
    "pismo HR",
    "oferta handlowa",
)
MONTHS = (
    "stycznia",
    "lutego",
    "marca",
    "kwietnia",
    "maja",
    "czerwca",
    "lipca",
    "sierpnia",
    "września",
    "października",
    "listopada",
    "grudnia",
)


def build_corpus(size: int = 50) -> list[dict[str, object]]:
    base_size = min(size, 40)
    records = [_build_document(index).record() for index in range(base_size)]
    if size > 40:
        records.extend(_build_hard_documents()[: size - 40])
    return records


def _build_document(index: int) -> DocumentBuilder:
    document_type = DOCUMENT_TYPES[index % len(DOCUMENT_TYPES)]
    builder = DocumentBuilder(doc_id=f"synthetic-{index + 1:03d}")
    if document_type == "umowa sprzedaży":
        _sale_agreement(builder, index)
    elif document_type == "umowa o pracę":
        _employment_contract(builder, index)
    elif document_type == "pozew":
        _lawsuit(builder, index)
    elif document_type == "wezwanie do zapłaty":
        _payment_demand(builder, index)
    elif document_type == "pismo HR":
        _hr_letter(builder, index)
    else:
        _commercial_offer(builder, index)
    return builder


def _sale_agreement(builder: DocumentBuilder, index: int) -> None:
    date_text = _date_text(index)
    seller = inflected_person(index, "nom")
    buyer = inflected_person(index + 7, "inst")
    company = COMPANIES[index % len(COMPANIES)]
    city, street = ADDRESSES[index % len(ADDRESSES)]
    builder.add("Umowa sprzedaży z dnia ")
    builder.add(date_text, EntityCategory.DATE)
    builder.add(" zawarta pomiędzy ")
    builder.add(seller, EntityCategory.PERSON)
    builder.add(" a ")
    builder.add(company, EntityCategory.COMPANY)
    builder.add(". Kupujący działał z ")
    builder.add(buyer, EntityCategory.PERSON)
    builder.add(", PESEL ")
    builder.add(_pesel(index), EntityCategory.PESEL)
    builder.add(", zam. w ")
    builder.add(city, EntityCategory.ADDRESS)
    builder.add(" przy ")
    builder.add(street, EntityCategory.ADDRESS)
    builder.add(". Rachunek do zapłaty: ")
    builder.add(format_nrb_groups(_nrb(index)), EntityCategory.BANK_ACCOUNT)
    builder.add(".")


def _employment_contract(builder: DocumentBuilder, index: int) -> None:
    employee = inflected_person(index + 1, "gen")
    representative = inflected_person(index + 9, "inst")
    company = COMPANIES[(index + 1) % len(COMPANIES)]
    city, street = ADDRESSES[(index + 1) % len(ADDRESSES)]
    builder.add("Umowa o pracę dotycząca ")
    builder.add(employee, EntityCategory.PERSON)
    builder.add(" została podpisana dnia ")
    builder.add(_date_text(index), EntityCategory.DATE)
    builder.add(" przez ")
    builder.add(company, EntityCategory.COMPANY)
    builder.add(", NIP ")
    builder.add(_nip(index), EntityCategory.NIP)
    builder.add(", REGON ")
    builder.add(_regon(index), EntityCategory.REGON)
    builder.add(". Pracodawcę reprezentował ")
    builder.add(representative, EntityCategory.PERSON)
    builder.add(" w ")
    builder.add(city, EntityCategory.ADDRESS)
    builder.add(", ")
    builder.add(street, EntityCategory.ADDRESS)
    builder.add(".")


def _lawsuit(builder: DocumentBuilder, index: int) -> None:
    plaintiff = inflected_person(index + 2, "nom")
    defendant = inflected_person(index + 11, "gen")
    company = COMPANIES[(index + 2) % len(COMPANIES)]
    city, street = ADDRESSES[(index + 2) % len(ADDRESSES)]
    builder.add("Pozew z dnia ")
    builder.add(_date_text(index), EntityCategory.DATE)
    builder.add(": Powód ")
    builder.add(plaintiff, EntityCategory.PERSON)
    builder.add(" wnosi o zasądzenie kwoty od ")
    builder.add(defendant, EntityCategory.PERSON)
    builder.add(". Pozwana spółka ")
    builder.add(company, EntityCategory.COMPANY)
    builder.add(" wskazuje dowód osobisty ")
    builder.add(_id_card(index), EntityCategory.ID_CARD)
    builder.add(" oraz adres w ")
    builder.add(city, EntityCategory.ADDRESS)
    builder.add(" przy ")
    builder.add(street, EntityCategory.ADDRESS)
    builder.add(".")


def _payment_demand(builder: DocumentBuilder, index: int) -> None:
    debtor = inflected_person(index + 3, "dat")
    creditor = inflected_person(index + 12, "gen")
    company = COMPANIES[(index + 3) % len(COMPANIES)]
    city, street = ADDRESSES[(index + 3) % len(ADDRESSES)]
    builder.add("Wezwanie do zapłaty z dnia ")
    builder.add(_date_text(index), EntityCategory.DATE)
    builder.add(" kieruje się do ")
    builder.add(debtor, EntityCategory.PERSON)
    builder.add(" na rzecz ")
    builder.add(creditor, EntityCategory.PERSON)
    builder.add(". Wierzyciel ")
    builder.add(company, EntityCategory.COMPANY)
    builder.add(", NIP ")
    builder.add(_nip(index), EntityCategory.NIP)
    builder.add(", oczekuje przelewu na rachunek ")
    builder.add(format_nrb_groups(_nrb(index)), EntityCategory.BANK_ACCOUNT)
    builder.add(". Adres dłużnika: ")
    builder.add(city, EntityCategory.ADDRESS)
    builder.add(", ")
    builder.add(street, EntityCategory.ADDRESS)
    builder.add(".")


def _hr_letter(builder: DocumentBuilder, index: int) -> None:
    employee = inflected_person(index + 4, "dat")
    manager = inflected_person(index + 13, "inst")
    company = COMPANIES[(index + 4) % len(COMPANIES)]
    city, street = ADDRESSES[(index + 4) % len(ADDRESSES)]
    builder.add("Pismo HR z dnia ")
    builder.add(_date_text(index), EntityCategory.DATE)
    builder.add(" przekazano ")
    builder.add(employee, EntityCategory.PERSON)
    builder.add(". Administratorem danych jest ")
    builder.add(company, EntityCategory.COMPANY)
    builder.add(", REGON ")
    builder.add(_regon(index), EntityCategory.REGON)
    builder.add(". Sprawę omówiono z ")
    builder.add(manager, EntityCategory.PERSON)
    builder.add(" w oddziale w ")
    builder.add(city, EntityCategory.ADDRESS)
    builder.add(", ")
    builder.add(street, EntityCategory.ADDRESS)
    builder.add(".")


def _commercial_offer(builder: DocumentBuilder, index: int) -> None:
    contact = inflected_person(index + 5, "inst")
    recipient = inflected_person(index + 14, "gen")
    company = COMPANIES[(index + 5) % len(COMPANIES)]
    city, street = ADDRESSES[(index + 5) % len(ADDRESSES)]
    builder.add("Oferta handlowa z dnia ")
    builder.add(_date_text(index), EntityCategory.DATE)
    builder.add(" została przygotowana przez ")
    builder.add(company, EntityCategory.COMPANY)
    builder.add(", NIP ")
    builder.add(_nip(index), EntityCategory.NIP)
    builder.add(". Kontakt prowadzono z ")
    builder.add(contact, EntityCategory.PERSON)
    builder.add(" dla ")
    builder.add(recipient, EntityCategory.PERSON)
    builder.add(". Siedziba: ")
    builder.add(city, EntityCategory.ADDRESS)
    builder.add(", ")
    builder.add(street, EntityCategory.ADDRESS)
    builder.add("; PESEL osoby kontaktowej ")
    builder.add(_pesel(index), EntityCategory.PESEL)
    builder.add(".")


def _build_hard_documents() -> list[dict[str, object]]:
    builders = [
        _hard_instrumental_name(),
        _hard_dative_name(),
        _hard_hyphenated_name(),
        _hard_feminine_surname(),
        _hard_surname_company(),
        _hard_invalid_pesel(),
        _hard_ocr_like_text(),
        _hard_hyphenated_middle_sentence(),
        _hard_long_dative_sentence(),
        _hard_multiple_entities_ocr_noise(),
    ]
    return [builder.record() for builder in builders]


def _build_expanded_documents() -> list[dict[str, object]]:
    builders = [
        _expanded_passport(),
        _expanded_payment_card(),
        _expanded_land_register(),
        _expanded_admin_case(),
        _expanded_gps(),
        _expanded_ip_addresses(),
        _expanded_mac_address(),
        _expanded_api_keys(),
        _expanded_money(),
        _expanded_birth_date(),
    ]
    return [builder.record() for builder in builders]


def _hard_instrumental_name() -> DocumentBuilder:
    builder = DocumentBuilder(doc_id="hard-041")
    builder.add("Po analizie akt, obejmującej dziewiętnaście załączników, rozmawiano z ")
    builder.add("Piotrem Nowakiem", EntityCategory.PERSON)
    builder.add(" o korespondencji wysłanej dnia ")
    builder.add("14 lutego 2025 r.", EntityCategory.DATE)
    builder.add(".")
    return builder


def _hard_dative_name() -> DocumentBuilder:
    builder = DocumentBuilder(doc_id="hard-042")
    builder.add("Decyzję, mimo obszernego uzasadnienia i wielu pouczeń, doręczono ")
    builder.add("Marii Kowalskiej", EntityCategory.PERSON)
    builder.add(" pod adresem ")
    builder.add("ul. Lipowej 21", EntityCategory.ADDRESS)
    builder.add(".")
    return builder


def _hard_hyphenated_name() -> DocumentBuilder:
    builder = DocumentBuilder(doc_id="hard-043")
    builder.add("W protokole przesłuchania wskazano, że ")
    builder.add("Anna Nowak-Kowalska", EntityCategory.PERSON)
    builder.add(" podała numer dowodu ")
    builder.add("ABC123459", EntityCategory.ID_CARD)
    builder.add(".")
    return builder


def _hard_feminine_surname() -> DocumentBuilder:
    builder = DocumentBuilder(doc_id="hard-044")
    builder.add("Zawiadomienie przekazano ")
    builder.add("Kowalskiej", EntityCategory.PERSON)
    builder.add(", która działała przez pełnomocnika w ")
    builder.add("Warszawie", EntityCategory.ADDRESS)
    builder.add(".")
    return builder


def _hard_surname_company() -> DocumentBuilder:
    builder = DocumentBuilder(doc_id="hard-045")
    builder.add("Stroną umowy nie był ")
    builder.add("Jan Kowalski", EntityCategory.PERSON)
    builder.add(", lecz kancelaria ")
    builder.add("Kowalski i Wspólnicy sp.k.", EntityCategory.COMPANY)
    builder.add(", NIP ")
    builder.add(generate_nip("200000001"), EntityCategory.NIP)
    builder.add(".")
    return builder


def _hard_invalid_pesel() -> DocumentBuilder:
    builder = DocumentBuilder(doc_id="hard-046")
    builder.add("W formularzu wpisano PESEL ")
    builder.add("44051401358", EntityCategory.PESEL)
    builder.add(", którego suma kontrolna wymaga ręcznej weryfikacji.")
    return builder


def _hard_ocr_like_text() -> DocumentBuilder:
    builder = DocumentBuilder(doc_id="hard-047")
    builder.add("Tekst po OCR: Jan KowaIski, PE5EL ")
    builder.add("44051401359", EntityCategory.PESEL)
    builder.add(", kontakt ")
    builder.add("jan.kowalski@example.com", EntityCategory.EMAIL)
    builder.add(".")
    return builder


def _hard_hyphenated_middle_sentence() -> DocumentBuilder:
    builder = DocumentBuilder(doc_id="hard-048")
    builder.add("Sąd, po rozpoznaniu sprawy w składzie jednoosobowym, zwrócił się do ")
    builder.add("Michała Zielińskiego-Wójcika", EntityCategory.PERSON)
    builder.add(" o potwierdzenie rachunku ")
    account = format_nrb_groups(generate_nrb("101000710000000000000123"))
    builder.add(account, EntityCategory.BANK_ACCOUNT)
    builder.add(".")
    return builder


def _hard_long_dative_sentence() -> DocumentBuilder:
    builder = DocumentBuilder(doc_id="hard-049")
    builder.add("Po bezskutecznym upływie terminu organ, nie rozstrzygając pozostałych zarzutów, ")
    builder.add("Tomaszowi Wiśniewskiemu", EntityCategory.PERSON)
    builder.add(" przesłał wezwanie na adres ")
    builder.add("ul. Prostej 12", EntityCategory.ADDRESS)
    builder.add(".")
    return builder


def _hard_multiple_entities_ocr_noise() -> DocumentBuilder:
    builder = DocumentBuilder(doc_id="hard-050")
    builder.add("OCR: sp0łka ")
    builder.add("Delta Finanse sp. z o.o.", EntityCategory.COMPANY)
    builder.add(" wskazała REG0N ")
    builder.add(generate_regon9("55550000"), EntityCategory.REGON)
    builder.add(" oraz e-maiI ")
    builder.add("biuro@delta.example", EntityCategory.EMAIL)
    builder.add(".")
    return builder


def _expanded_passport() -> DocumentBuilder:
    builder = DocumentBuilder(doc_id="expanded-083")
    builder.add("Seria i numer paszportu: ")
    builder.add(generate_passport(), EntityCategory.PASSPORT)
    builder.add(". Kod produktu AB1234567 nie jest dokumentem.")
    return builder


def _expanded_payment_card() -> DocumentBuilder:
    builder = DocumentBuilder(doc_id="expanded-084")
    builder.add("Karta płatnicza: ")
    builder.add("4111 1111 1111 1111", EntityCategory.PAYMENT_CARD)
    builder.add(". Numer 4111 1111 1111 1112 jest błędny.")
    return builder


def _expanded_land_register() -> DocumentBuilder:
    builder = DocumentBuilder(doc_id="expanded-085")
    builder.add("Nieruchomość ma księgę wieczystą nr ")
    builder.add(generate_land_register(), EntityCategory.LAND_REGISTER)
    builder.add(". Oznaczenie GD1G/0001234/9 ma błędny format.")
    return builder


def _expanded_admin_case() -> DocumentBuilder:
    builder = DocumentBuilder(doc_id="expanded-086")
    builder.add("Znak sprawy: ")
    builder.add("DOP-1.4131.15.2026", EntityCategory.ADMIN_CASE)
    builder.add(". Zapis dop-1-4131-15 ma błędne separatory.")
    return builder


def _expanded_gps() -> DocumentBuilder:
    builder = DocumentBuilder(doc_id="expanded-087")
    builder.add("Punkt ma współrzędne ")
    builder.add("54.3520, 18.6466", EntityCategory.GPS)
    builder.add(" oraz ")
    builder.add("54°21'07\"N", EntityCategory.GPS)
    builder.add(". Para dziewięćdziesiąt jeden i osiemnaście stopni przekracza zakres.")
    return builder


def _expanded_ip_addresses() -> DocumentBuilder:
    builder = DocumentBuilder(doc_id="expanded-088")
    builder.add("Log zawiera adresy ")
    builder.add("192.0.2.15", EntityCategory.IP_ADDRESS)
    builder.add(" i ")
    builder.add("2001:db8::15", EntityCategory.IP_ADDRESS)
    builder.add(". Wartość 999-0-2-15 nie jest adresem IP.")
    return builder


def _expanded_mac_address() -> DocumentBuilder:
    builder = DocumentBuilder(doc_id="expanded-089")
    builder.add("Interfejs sieciowy ma adres ")
    builder.add("02:00:5E:10:00:00", EntityCategory.MAC_ADDRESS)
    builder.add(". Skrócone 02:00:5E:10:00 jest niepoprawne.")
    return builder


def _expanded_api_keys() -> DocumentBuilder:
    builder = DocumentBuilder(doc_id="expanded-090")
    builder.add("Repozytorium ujawniło klucz ")
    builder.add("ghp_0123456789abcdefghijABCDEFGHIJ12", EntityCategory.API_KEY)
    builder.add(" oraz nagłówek ")
    builder.add("Bearer abcdefghijklmnopqrstuvwxyz012345", EntityCategory.API_KEY)
    builder.add(". Prefiks sk-short jest za krótki.")
    return builder


def _expanded_money() -> DocumentBuilder:
    builder = DocumentBuilder(doc_id="expanded-091")
    builder.add("Wynagrodzenie wynosi ")
    builder.add("1 234,56", EntityCategory.MONEY)
    builder.add(" zł, a opłata ")
    builder.add("250", EntityCategory.MONEY)
    builder.add(" EUR. Liczba 9876 bez waluty nie jest kwotą.")
    return builder


def _expanded_birth_date() -> DocumentBuilder:
    builder = DocumentBuilder(doc_id="expanded-092")
    builder.add("Data urodzenia: ")
    builder.add("12.03.1985", EntityCategory.DATE)
    builder.add("; druga osoba urodzona ")
    builder.add("4 maja 1990 r.", EntityCategory.DATE)
    builder.add(".")
    return builder


def _date_text(index: int) -> str:
    day = index % 27 + 1
    month = MONTHS[index % len(MONTHS)]
    year = 2024 + index % 3
    return f"{day} {month} {year} r."


def _pesel(index: int) -> str:
    birth_date = date(1970 + index % 30, index % 12 + 1, index % 27 + 1)
    return generate_pesel(birth_date=birth_date, serial=f"{1000 + index:04d}")


def _nip(index: int) -> str:
    return generate_nip(f"{100000000 + index:09d}")


def _regon(index: int) -> str:
    return generate_regon9(f"{12340000 + index:08d}")


def _id_card(index: int) -> str:
    letters = chr(ord("A") + index % 20) + chr(ord("B") + index % 20) + chr(ord("C") + index % 20)
    return generate_id_card(letters=letters, suffix=f"{12345 + index:05d}"[-5:])


def _nrb(index: int) -> str:
    return generate_nrb(f"10100071{index + 1:016d}")


def main() -> None:
    DEFAULT_OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    preserved = _load_preserved_records(DEFAULT_OUTPUT)
    records = [*build_corpus(), *preserved, *_build_expanded_documents()]
    with DEFAULT_OUTPUT.open("w", encoding="utf-8") as output:
        for record in records:
            output.write(_serialize_record(record) + "\n")


def _serialize_record(record: dict[str, object]) -> str:
    record_id = str(record.get("id", ""))
    if record_id.startswith(("dict-", "prompt24-")):
        return json.dumps(record, ensure_ascii=False, separators=(",", ":"))
    return json.dumps(record, ensure_ascii=False)


def _load_preserved_records(path: Path) -> list[dict[str, object]]:
    if not path.exists():
        return []
    preserved_prefixes = ("dict-", "prompt24-", "prompt25-")
    with path.open(encoding="utf-8") as corpus:
        records = [json.loads(line) for line in corpus if line.strip()]
    return [
        record
        for record in records
        if str(record.get("id", "")).startswith(preserved_prefixes)
    ]


if __name__ == "__main__":
    main()
