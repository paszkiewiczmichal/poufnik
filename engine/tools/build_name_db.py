"""Build the packaged Polish first-name and surname SQLite artifact.

Sources verified 2026-07-09:
- dane.gov.pl dataset 1667, "Lista imion występujących w rejestrze PESEL",
  license CC0 1.0. The builder uses the latest national first-name and second-name
  CSV resources for living people.
- dane.gov.pl dataset 1681, "Nazwiska występujące w rejestrze PESEL",
  license CC0 1.0. The builder uses the latest national female and male surname
  CSV resources for living people.
- SJP.PL spell-checking dictionary, used only to derive the homograph table,
  is offered under multiple licenses including Apache 2.0.

Network is used only by this build tool. Runtime detection reads names.db from
the installed package and never downloads data.
"""

from __future__ import annotations

import csv
import io
import json
import re
import sqlite3
import time
import unicodedata
import urllib.request
import zipfile
from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

DATASETS_API = "https://api.dane.gov.pl/1.4/datasets/{dataset_id}/resources?per_page=100"
DATASET_API = "https://api.dane.gov.pl/1.4/datasets/{dataset_id}"
SJP_MY_SPELL_URL = "https://sjp.pl/sl/ort/sjp-myspell-pl-20260601.zip"
USER_AGENT = "Poufnik-name-db-builder/1.0"
MIN_COUNT = 5
DEFAULT_OUTPUT = (
    Path(__file__).resolve().parents[1]
    / "src"
    / "anonymizer_engine"
    / "detection"
    / "resources"
    / "names.db"
)

Gender = Literal["female", "male", "unisex"]

MANUAL_HOMOGRAPH_SEEDS = {
    "agent",
    "anioł",
    "aparat",
    "atlas",
    "baca",
    "bachor",
    "baran",
    "baranek",
    "bąk",
    "bielik",
    "biskup",
    "bocian",
    "boruta",
    "bratek",
    "brzoza",
    "buk",
    "burza",
    "cebula",
    "chmiel",
    "chmura",
    "cieśla",
    "czech",
    "czyż",
    "dąb",
    "duda",
    "dziedzic",
    "dzięcioł",
    "figa",
    "flis",
    "gaj",
    "gajda",
    "gawron",
    "góra",
    "góral",
    "gołąb",
    "grab",
    "gruszka",
    "gwiazda",
    "indyk",
    "jabłoń",
    "jagoda",
    "jarząb",
    "jawor",
    "jeleń",
    "jesion",
    "jeż",
    "kaczka",
    "kalina",
    "kamień",
    "kania",
    "kapusta",
    "karp",
    "kasza",
    "kawka",
    "kiełbasa",
    "klimek",
    "klon",
    "kłos",
    "kobiałka",
    "kogut",
    "komar",
    "konar",
    "koń",
    "kopacz",
    "kopyt",
    "kos",
    "kowal",
    "koza",
    "kozioł",
    "król",
    "kruk",
    "krupa",
    "krzak",
    "krzyż",
    "kula",
    "kurek",
    "kwiecień",
    "las",
    "lis",
    "łabędź",
    "łapa",
    "łata",
    "łuk",
    "maj",
    "mak",
    "malina",
    "mądry",
    "marzec",
    "mazur",
    "młynarz",
    "mróz",
    "much",
    "niedźwiedź",
    "orzeł",
    "owczarek",
    "pająk",
    "paluch",
    "paw",
    "piątek",
    "pietrzyk",
    "pilarz",
    "pióro",
    "piskorz",
    "płatek",
    "pług",
    "polak",
    "popiel",
    "potok",
    "przybył",
    "ptak",
    "rak",
    "rokita",
    "róża",
    "rudzik",
    "rybak",
    "rzepa",
    "sikora",
    "skowronek",
    "słowik",
    "sowa",
    "sroka",
    "stolarz",
    "strzelec",
    "szczupak",
    "szewc",
    "środa",
    "świerk",
    "turek",
    "urban",
    "wilk",
    "wrona",
    "wróbel",
    "zając",
    "zamek",
    "zawada",
    "zięba",
    "żaba",
    "żak",
    "żuk",
    "żuraw",
}


@dataclass(frozen=True)
class SourceResource:
    dataset_id: str
    resource_id: str
    title: str
    data_date: str
    csv_url: str
    page_url: str
    gender: Gender
    kind: Literal["first_name", "surname"]


def main() -> None:
    output_path = DEFAULT_OUTPUT
    output_path.parent.mkdir(parents=True, exist_ok=True)

    dataset_licenses = _dataset_licenses()
    resources = _selected_resources()
    first_names = _load_names(resources, kind="first_name")
    surnames = _load_names(resources, kind="surname")
    common_words = _download_sjp_common_words()
    surname_lookup = {name.casefold(): name for name in surnames}
    homograph_keys = {
        key
        for key in set(surname_lookup) & common_words
        if not _looks_like_adjectival_surname(key)
    } | (MANUAL_HOMOGRAPH_SEEDS & set(surname_lookup))
    homographs = sorted(surname_lookup[key] for key in homograph_keys)

    row_counts = {
        "first_names": len(first_names),
        "surnames": len(surnames),
        "homographs": len(homographs),
        "sources": len(resources),
    }
    data_dates = sorted({resource.data_date for resource in resources})
    source_urls = {
        "datasets": {
            "1667": "https://dane.gov.pl/dataset/1667,lista-imion-wystepujacych-w-rejestrze-pesel-osoby-zyjace",
            "1681": "https://dane.gov.pl/dataset/1681,nazwiska-osob-zyjacych-wystepujace-w-rejestrze-pesel",
        },
        "resources": [
            {
                "title": resource.title,
                "csv_url": resource.csv_url,
                "page_url": resource.page_url,
                "data_date": resource.data_date,
            }
            for resource in resources
        ],
        "homograph_dictionary": SJP_MY_SPELL_URL,
        "licenses": dataset_licenses,
    }

    _write_db(
        output_path=output_path,
        first_names=first_names,
        surnames=surnames,
        homographs=homographs,
        source_urls=source_urls,
        data_date=", ".join(data_dates),
        row_counts=row_counts,
    )
    print(json.dumps({"output": str(output_path), **row_counts}, ensure_ascii=False, indent=2))


def _dataset_licenses() -> dict[str, str]:
    licenses: dict[str, str] = {}
    for dataset_id in ("1667", "1681"):
        payload = _download_json(DATASET_API.format(dataset_id=dataset_id))
        licenses[dataset_id] = payload["data"]["attributes"]["license_name"]
    return licenses


def _selected_resources() -> list[SourceResource]:
    first_name_resources = _download_json(DATASETS_API.format(dataset_id=1667))["data"]
    surname_resources = _download_json(DATASETS_API.format(dataset_id=1681))["data"]
    selected = [
        *_select_latest_first_name_resources(first_name_resources),
        *_select_latest_surname_resources(surname_resources),
    ]
    return sorted(selected, key=lambda item: (item.kind, item.gender, item.title))


def _select_latest_first_name_resources(resources: list[dict[str, Any]]) -> list[SourceResource]:
    slots: dict[tuple[Gender, str], SourceResource] = {}
    for resource in resources:
        attributes = resource["attributes"]
        title = attributes["title"].casefold()
        if "imię pierwsze" not in title and "imię drugie" not in title:
            continue
        gender: Gender = "female" if "żeńskich" in title else "male"
        name_slot = "second" if "imię drugie" in title else "first"
        candidate = _resource_from_payload(resource, gender=gender, kind="first_name")
        key = (gender, name_slot)
        if key not in slots or candidate.data_date > slots[key].data_date:
            slots[key] = candidate
    return list(slots.values())


def _select_latest_surname_resources(resources: list[dict[str, Any]]) -> list[SourceResource]:
    slots: dict[Gender, SourceResource] = {}
    for resource in resources:
        attributes = resource["attributes"]
        title = attributes["title"].casefold()
        if not title.startswith("nazwiska ") or "województwa" in title:
            continue
        gender: Gender = "female" if "żeńskie" in title else "male"
        candidate = _resource_from_payload(resource, gender=gender, kind="surname")
        if gender not in slots or candidate.data_date > slots[gender].data_date:
            slots[gender] = candidate
    return list(slots.values())


def _resource_from_payload(
    resource: dict[str, Any],
    *,
    gender: Gender,
    kind: Literal["first_name", "surname"],
) -> SourceResource:
    attributes = resource["attributes"]
    csv_url = attributes.get("csv_download_url") or _csv_download_url(attributes["files"])
    return SourceResource(
        dataset_id=resource["relationships"]["dataset"]["data"]["id"],
        resource_id=resource["id"],
        title=attributes["title"],
        data_date=attributes["data_date"],
        csv_url=csv_url,
        page_url=resource["links"]["self"],
        gender=gender,
        kind=kind,
    )


def _csv_download_url(files_payload: list[dict[str, Any]]) -> str:
    for file_payload in files_payload:
        if file_payload["format"].casefold() == "csv":
            return file_payload["download_url"]
    msg = "Resource has no CSV download URL"
    raise RuntimeError(msg)


def _load_names(
    resources: Iterable[SourceResource],
    *,
    kind: Literal["first_name", "surname"],
) -> dict[str, tuple[int, Gender]]:
    merged: dict[str, dict[str, Any]] = defaultdict(lambda: {"count": 0, "genders": set()})
    for resource in resources:
        if resource.kind != kind:
            continue
        for name, count in _read_name_rows(resource):
            if count < MIN_COUNT:
                continue
            merged[name]["count"] += count
            merged[name]["genders"].add(resource.gender)

    result: dict[str, tuple[int, Gender]] = {}
    for name, payload in merged.items():
        genders = payload["genders"]
        gender: Gender = next(iter(genders)) if len(genders) == 1 else "unisex"
        result[name] = (int(payload["count"]), gender)
    return dict(sorted(result.items()))


def _read_name_rows(resource: SourceResource) -> Iterable[tuple[str, int]]:
    text = _download_bytes(resource.csv_url).decode("utf-8-sig")
    sample = text[:4096]
    dialect = csv.Sniffer().sniff(sample, delimiters=",;")
    reader = csv.DictReader(io.StringIO(text), dialect=dialect)
    if reader.fieldnames is None:
        return []

    name_field = _first_matching_field(reader.fieldnames, ["IMIĘ", "Nazwisko"])
    count_field = _first_matching_field(reader.fieldnames, ["LICZBA", "Liczba"])
    return [
        (normalized, count)
        for row in reader
        if (normalized := _normalize_name(row.get(name_field, "")))
        and (count := _parse_count(row.get(count_field, ""))) >= 0
    ]


def _first_matching_field(fieldnames: list[str], needles: list[str]) -> str:
    for fieldname in fieldnames:
        if any(needle.casefold() in fieldname.casefold() for needle in needles):
            return fieldname
    msg = f"CSV does not contain any of fields matching {needles!r}: {fieldnames!r}"
    raise RuntimeError(msg)


def _parse_count(value: str | None) -> int:
    if value is None:
        return -1
    digits = re.sub(r"\D", "", value)
    return int(digits) if digits else -1


def _normalize_name(value: str) -> str:
    value = unicodedata.normalize("NFC", value).strip()
    if not value:
        return ""
    return "-".join(
        " ".join(_title_part(part) for part in segment.split())
        for segment in value.split("-")
    )


def _title_part(value: str) -> str:
    value = value.casefold()
    return value[:1].upper() + value[1:]


def _looks_like_adjectival_surname(value: str) -> bool:
    return value.endswith(("ski", "ska", "cki", "cka", "zki", "zka"))


def _download_sjp_common_words() -> set[str]:
    payload = _download_bytes(SJP_MY_SPELL_URL)
    common_words: set[str] = set()
    with zipfile.ZipFile(io.BytesIO(payload)) as outer_zip:
        with outer_zip.open("pl_PL.zip") as nested_zip_file:
            nested_payload = nested_zip_file.read()
    with zipfile.ZipFile(io.BytesIO(nested_payload)) as inner_zip:
        with inner_zip.open("pl_PL.dic") as dictionary_file:
            for raw_line in dictionary_file:
                line = _decode_dictionary_line(raw_line).strip()
                if not line or line.isdecimal():
                    continue
                word = line.split("/", 1)[0]
                if word and word[0].islower():
                    common_words.add(unicodedata.normalize("NFC", word).casefold())
    return common_words


def _decode_dictionary_line(raw_line: bytes) -> str:
    for encoding in ("utf-8", "cp1250", "iso-8859-2"):
        try:
            return raw_line.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw_line.decode("utf-8", errors="ignore")


def _write_db(
    *,
    output_path: Path,
    first_names: dict[str, tuple[int, Gender]],
    surnames: dict[str, tuple[int, Gender]],
    homographs: list[str],
    source_urls: dict[str, Any],
    data_date: str,
    row_counts: dict[str, int],
) -> None:
    temporary_path = output_path.with_suffix(".tmp")
    if temporary_path.exists():
        temporary_path.unlink()
    with sqlite3.connect(temporary_path) as connection:
        connection.execute("PRAGMA journal_mode=OFF")
        connection.execute(
            "CREATE TABLE first_names(name TEXT PRIMARY KEY, count INTEGER, gender TEXT)"
        )
        connection.execute(
            "CREATE TABLE surnames(name TEXT PRIMARY KEY, count INTEGER, gender TEXT)"
        )
        connection.execute("CREATE TABLE homographs(name TEXT PRIMARY KEY)")
        connection.execute(
            "CREATE TABLE meta("
            "source_urls TEXT NOT NULL, "
            "data_date TEXT NOT NULL, "
            "built_at TEXT NOT NULL, "
            "row_counts TEXT NOT NULL"
            ")"
        )
        connection.executemany(
            "INSERT INTO first_names(name, count, gender) VALUES (?, ?, ?)",
            [(name, count, gender) for name, (count, gender) in first_names.items()],
        )
        connection.executemany(
            "INSERT INTO surnames(name, count, gender) VALUES (?, ?, ?)",
            [(name, count, gender) for name, (count, gender) in surnames.items()],
        )
        connection.executemany(
            "INSERT INTO homographs(name) VALUES (?)",
            [(name,) for name in homographs],
        )
        connection.execute(
            "INSERT INTO meta(source_urls, data_date, built_at, row_counts) VALUES (?, ?, ?, ?)",
            (
                json.dumps(source_urls, ensure_ascii=False, sort_keys=True),
                data_date,
                datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z"),
                json.dumps(row_counts, ensure_ascii=False, sort_keys=True),
            ),
        )
        connection.execute("CREATE INDEX first_names_name_idx ON first_names(name)")
        connection.execute("CREATE INDEX surnames_name_idx ON surnames(name)")
        connection.execute("CREATE INDEX homographs_name_idx ON homographs(name)")
        connection.commit()
    connection.close()
    _replace_with_retry(temporary_path, output_path)


def _replace_with_retry(source: Path, target: Path) -> None:
    for attempt in range(5):
        try:
            source.replace(target)
            return
        except PermissionError:
            if attempt == 4:
                raise
            time.sleep(0.2)


def _download_json(url: str) -> dict[str, Any]:
    return json.loads(_download_bytes(url).decode("utf-8"))


def _download_bytes(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read()


if __name__ == "__main__":
    main()
