"""Build the packaged Polish locality SQLite artifact from TERYT/SIMC.

Sources verified 2026-07-10:
- GUS eTERYT "Pliki pełne", SIMC urzędowy. GUS documents that TERYT data
  is public, free of charge and downloadable as complete CSV/XML files.

Network is used only by this build tool. Runtime detection reads places.db from
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
import urllib.parse
import urllib.request
import zipfile
from dataclasses import dataclass
from datetime import UTC, datetime
from html.parser import HTMLParser
from pathlib import Path

FULL_FILES_URL = (
    "https://eteryt.stat.gov.pl/eTeryt/rejestr_teryt/udostepnianie_danych/"
    "baza_teryt/uzytkownicy_indywidualni/pobieranie/pliki_pelne.aspx?contrast=default"
)
SIMC_POSTBACK_TARGET = "ctl00$body$BSIMCUrzedowyPobierz"
USER_AGENT = "Poufnik-place-db-builder/1.0"
DEFAULT_OUTPUT = (
    Path(__file__).resolve().parents[1]
    / "src"
    / "anonymizer_engine"
    / "detection"
    / "resources"
    / "places.db"
)

_MANUAL_FORMS = {
    "gdańsk": {"gdańsku", "gdańska", "gdańskiem"},
    "gdynia": {"gdyni"},
    "kraków": {"krakowie", "krakowa", "krakowem"},
    "lublin": {"lublinie", "lublina", "lublinem"},
    "łódź": {"łodzi", "łodzią"},
    "poznań": {"poznaniu", "poznania", "poznaniem"},
    "sopot": {"sopocie", "sopotu", "sopotem"},
    "szczecin": {"szczecinie", "szczecina", "szczecinem"},
    "warszawa": {"warszawy", "warszawie", "warszawą"},
    "wrocław": {"wrocławiu", "wrocławia", "wrocławiem"},
}


@dataclass(frozen=True)
class Locality:
    name: str
    simc: str
    kind: str
    data_date: str


class _InputParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.fields: dict[str, str] = {}

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.casefold() != "input":
            return
        values = dict(attrs)
        name = values.get("name")
        if name:
            self.fields[name] = values.get("value") or ""


def main() -> None:
    output_path = DEFAULT_OUTPUT
    output_path.parent.mkdir(parents=True, exist_ok=True)
    localities, archive_name = _download_simc_localities()
    forms = _build_forms(localities)
    data_dates = sorted({item.data_date for item in localities if item.data_date})
    row_counts = {
        "localities": len(localities),
        "locality_forms": len(forms),
    }
    source_urls = {
        "source": FULL_FILES_URL,
        "postback_target": SIMC_POSTBACK_TARGET,
        "archive_name": archive_name,
        "license_note": "GUS eTERYT: public register data, free complete CSV/XML downloads.",
    }
    _write_db(
        output_path=output_path,
        localities=localities,
        forms=forms,
        source_urls=source_urls,
        data_date=", ".join(data_dates),
        row_counts=row_counts,
    )
    print(json.dumps({"output": str(output_path), **row_counts}, ensure_ascii=False, indent=2))


def _download_simc_localities() -> tuple[list[Locality], str]:
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor())
    page_request = urllib.request.Request(FULL_FILES_URL, headers={"User-Agent": USER_AGENT})
    with opener.open(page_request, timeout=60) as response:
        html = response.read().decode("utf-8", errors="ignore")

    parser = _InputParser()
    parser.feed(html)
    fields = dict(parser.fields)
    fields["__EVENTTARGET"] = SIMC_POSTBACK_TARGET
    fields["__EVENTARGUMENT"] = ""

    post_request = urllib.request.Request(
        FULL_FILES_URL,
        data=urllib.parse.urlencode(fields).encode(),
        headers={
            "User-Agent": USER_AGENT,
            "Content-Type": "application/x-www-form-urlencoded",
        },
    )
    with opener.open(post_request, timeout=120) as response:
        archive_name = _archive_name(response.headers.get("Content-Disposition", ""))
        payload = response.read()

    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        csv_name = next(name for name in archive.namelist() if name.casefold().endswith(".csv"))
        rows = _read_csv(archive.read(csv_name).decode("utf-8-sig"))
    return rows, archive_name or csv_name.replace(".csv", ".zip")


def _read_csv(text: str) -> list[Locality]:
    reader = csv.DictReader(io.StringIO(text), delimiter=";")
    rows: list[Locality] = []
    for row in reader:
        name = _normalize_name(row.get("NAZWA", ""))
        simc = (row.get("SYM") or "").strip()
        if not name or not simc:
            continue
        rows.append(
            Locality(
                name=name,
                simc=simc,
                kind=(row.get("RM") or "").strip(),
                data_date=(row.get("STAN_NA") or "").strip(),
            )
        )
    return rows


def _build_forms(localities: list[Locality]) -> dict[str, str]:
    forms: dict[str, str] = {}
    for locality in localities:
        normalized = _normalize_key(locality.name)
        if not normalized:
            continue
        for form in _inflected_forms(normalized):
            forms.setdefault(form, normalized)
    for base, variants in _MANUAL_FORMS.items():
        forms.setdefault(base, base)
        for variant in variants:
            forms.setdefault(variant, base)
    return dict(sorted(forms.items()))


def _inflected_forms(name: str) -> set[str]:
    forms = {name}
    if " " in name or "-" in name:
        return forms
    if name.endswith("ia") and len(name) > 4:
        forms.add(name[:-1] + "i")
    elif name.endswith("a") and len(name) > 3:
        forms.add(name[:-1] + "y")
        forms.add(name[:-1] + "ie")
        forms.add(name[:-1] + "ą")
    if name.endswith("ów") and len(name) > 4:
        forms.add(name[:-2] + "owie")
        forms.add(name[:-2] + "owa")
    return forms


def _write_db(
    *,
    output_path: Path,
    localities: list[Locality],
    forms: dict[str, str],
    source_urls: dict[str, str],
    data_date: str,
    row_counts: dict[str, int],
) -> None:
    temporary_path = output_path.with_suffix(".tmp")
    if temporary_path.exists():
        temporary_path.unlink()
    with sqlite3.connect(temporary_path) as connection:
        connection.execute("PRAGMA journal_mode=OFF")
        connection.execute(
            "CREATE TABLE localities(name TEXT NOT NULL, simc TEXT PRIMARY KEY, kind TEXT)"
        )
        connection.execute(
            "CREATE TABLE locality_forms(form TEXT PRIMARY KEY, canonical_name TEXT NOT NULL)"
        )
        connection.execute(
            "CREATE TABLE meta("
            "source_urls TEXT NOT NULL, "
            "data_date TEXT NOT NULL, "
            "built_at TEXT NOT NULL, "
            "row_counts TEXT NOT NULL"
            ")"
        )
        connection.executemany(
            "INSERT INTO localities(name, simc, kind) VALUES (?, ?, ?)",
            [(item.name, item.simc, item.kind) for item in localities],
        )
        connection.executemany(
            "INSERT INTO locality_forms(form, canonical_name) VALUES (?, ?)",
            [(form, canonical) for form, canonical in forms.items()],
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
        connection.execute("CREATE INDEX locality_forms_form_idx ON locality_forms(form)")
        connection.commit()
    connection.close()
    _replace_with_retry(temporary_path, output_path)


def _archive_name(value: str) -> str:
    match = re.search(r"filename=\"?([^\";]+)", value)
    return match.group(1) if match else ""


def _normalize_name(value: str) -> str:
    normalized = unicodedata.normalize("NFC", value).strip()
    return re.sub(r"\s+", " ", normalized)


def _normalize_key(value: str) -> str:
    return _normalize_name(value).casefold()


def _replace_with_retry(source: Path, target: Path) -> None:
    for attempt in range(5):
        try:
            source.replace(target)
            return
        except PermissionError:
            if attempt == 4:
                raise
            time.sleep(0.2)


if __name__ == "__main__":
    main()
