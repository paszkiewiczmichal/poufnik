"""Public institution recognizer used to suppress false sensitive-data matches."""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any

from anonymizer_engine.detection.models import (
    DetectedEntity,
    EntityCategory,
    EntityStatus,
    ValidationStatus,
)

_PLACE_WORD = r"(?-i:[A-ZĄĆĘŁŃÓŚŹŻ])[\wąćęłńóśźżĄĆĘŁŃÓŚŹŻ.-]*"
_PLACE = rf"{_PLACE_WORD}(?:\s+{_PLACE_WORD}){{0,3}}"
_MINISTRY_TAIL_WORD = r"(?:i|w|we|oraz|do|dla|z|ze|[A-ZĄĆĘŁŃÓŚŹŻ][\wąćęłńóśźżĄĆĘŁŃÓŚŹŻ.-]*)"
_COURT_DEPARTMENT = (
    rf"(?:,\s*[IVXLCDM]{{1,8}}\s+Wydział(?:\s+{_PLACE_WORD}){{1,5}}(?:\s+KRS)?)?"
)

_CURATED_PUBLIC_INSTITUTIONS = [
    "Agencja Bezpieczeństwa Wewnętrznego",
    "Agencja Mienia Wojskowego",
    "Agencja Restrukturyzacji i Modernizacji Rolnictwa",
    "Agencja Rezerw Strategicznych",
    "Agencja Rozwoju Przemysłu",
    "Agencja Wywiadu",
    "Archiwum Akt Nowych",
    "Bankowy Fundusz Gwarancyjny",
    "Biuro Bezpieczeństwa Narodowego",
    "Centrum e-Zdrowia",
    "Centralne Biuro Antykorupcyjne",
    "Centralne Biuro Śledcze Policji",
    "Centralny Ośrodek Informatyki",
    "Centrum Obsługi Administracji Rządowej",
    "Centrum Projektów Polska Cyfrowa",
    "Centrum Unijnych Projektów Transportowych",
    "Dyrekcja Generalna Lasów Państwowych",
    "Europejski Bank Centralny",
    "Europejski Fundusz Inwestycyjny",
    "Europejski Inspektor Ochrony Danych",
    "Europejski Komitet Ekonomiczno-Społeczny",
    "Europejski Rzecznik Praw Obywatelskich",
    "Europejski Trybunał Obrachunkowy",
    "Europejski Trybunał Praw Człowieka",
    "Eurojust",
    "Europol",
    "Fundusz Ubezpieczeń Społecznych",
    "Generalna Dyrekcja Dróg Krajowych i Autostrad",
    "Generalny Inspektor Informacji Finansowej",
    "Generalny Inspektor Ochrony Danych Osobowych",
    "Główny Inspektorat Farmaceutyczny",
    "Główny Inspektorat Jakości Handlowej Artykułów Rolno-Spożywczych",
    "Główny Inspektorat Ochrony Roślin i Nasiennictwa",
    "Główny Inspektorat Ochrony Środowiska",
    "Główny Inspektorat Sanitarny",
    "Główny Inspektorat Transportu Drogowego",
    "Główny Urząd Geodezji i Kartografii",
    "Główny Urząd Miar",
    "Główny Urząd Nadzoru Budowlanego",
    "Główny Urząd Statystyczny",
    "Instytut Meteorologii i Gospodarki Wodnej",
    "Izba Administracji Skarbowej",
    "Kancelaria Prezesa Rady Ministrów",
    "Kancelaria Prezydenta Rzeczypospolitej Polskiej",
    "Kancelaria Sejmu",
    "Kancelaria Senatu",
    "Kasa Rolniczego Ubezpieczenia Społecznego",
    "Komenda Główna Państwowej Straży Pożarnej",
    "Komenda Główna Policji",
    "Komenda Główna Straży Granicznej",
    "Komisja Europejska",
    "Komisja Nadzoru Finansowego",
    "Komitet Regionów",
    "Krajowa Administracja Skarbowa",
    "Krajowa Informacja Skarbowa",
    "Krajowa Rada Radiofonii i Telewizji",
    "Krajowa Rada Sądownictwa",
    "Krajowa Szkoła Administracji Publicznej",
    "Krajowa Szkoła Sądownictwa i Prokuratury",
    "Krajowe Biuro Wyborcze",
    "Krajowy Ośrodek Wsparcia Rolnictwa",
    "Krajowy Rejestr Karny",
    "Minister Finansów i Gospodarki",
    "Minister Obrony Narodowej",
    "Minister Spraw Wewnętrznych i Administracji",
    "Minister Spraw Zagranicznych",
    "Minister Sprawiedliwości",
    "Ministerstwo Aktywów Państwowych",
    "Ministerstwo Cyfryzacji",
    "Ministerstwo Edukacji",
    "Ministerstwo Energii",
    "Ministerstwo Finansów i Gospodarki",
    "Ministerstwo Funduszy i Polityki Regionalnej",
    "Ministerstwo Infrastruktury",
    "Ministerstwo Klimatu i Środowiska",
    "Ministerstwo Kultury i Dziedzictwa Narodowego",
    "Ministerstwo Nauki i Szkolnictwa Wyższego",
    "Ministerstwo Obrony Narodowej",
    "Ministerstwo Rodziny, Pracy i Polityki Społecznej",
    "Ministerstwo Rolnictwa i Rozwoju Wsi",
    "Ministerstwo Sportu i Turystyki",
    "Ministerstwo Spraw Wewnętrznych i Administracji",
    "Ministerstwo Spraw Zagranicznych",
    "Ministerstwo Sprawiedliwości",
    "Ministerstwo Zdrowia",
    "Narodowe Centrum Badań i Rozwoju",
    "Narodowe Centrum Nauki",
    "Narodowe Centrum Zdrowia Publicznego",
    "Narodowy Bank Polski",
    "Narodowy Fundusz Ochrony Środowiska i Gospodarki Wodnej",
    "Narodowy Fundusz Zdrowia",
    "Narodowy Instytut Wolności",
    "Naczelna Dyrekcja Archiwów Państwowych",
    "Naczelny Sąd Administracyjny",
    "Najwyższa Izba Kontroli",
    "Państwowa Agencja Atomistyki",
    "Państwowa Inspekcja Pracy",
    "Państwowa Komisja Wyborcza",
    "Państwowa Straż Pożarna",
    "Parlament Europejski",
    "Polska Agencja Inwestycji i Handlu",
    "Polska Agencja Kosmiczna",
    "Polska Agencja Nadzoru Audytowego",
    "Polska Agencja Rozwoju Przedsiębiorczości",
    "Polski Komitet Normalizacyjny",
    "Polskie Centrum Akredytacji",
    "Polskie Centrum Pomocy Międzynarodowej",
    "Polskie Wody",
    "Prezes Rady Ministrów",
    "Prezydent Rzeczypospolitej Polskiej",
    "Prezydent RP",
    "Prokuratoria Generalna Rzeczypospolitej Polskiej",
    "Prokuratura Krajowa",
    "Rada Europejska",
    "Rada Ministrów",
    "Rada Polityki Pieniężnej",
    "Rada Unii Europejskiej",
    "Rada UE",
    "Regionalna Dyrekcja Ochrony Środowiska",
    "Rzecznik Finansowy",
    "Rzecznik Małych i Średnich Przedsiębiorców",
    "Rzecznik Praw Dziecka",
    "Rzecznik Praw Obywatelskich",
    "Rządowe Centrum Bezpieczeństwa",
    "Rządowe Centrum Legislacji",
    "Samorządowe Kolegium Odwoławcze",
    "Sejm Rzeczypospolitej Polskiej",
    "Sejm RP",
    "Senat Rzeczypospolitej Polskiej",
    "Senat RP",
    "Straż Graniczna",
    "Służba Celno-Skarbowa",
    "Służba Ochrony Państwa",
    "Trybunał Konstytucyjny",
    "Trybunał Sprawiedliwości Unii Europejskiej",
    "TSUE",
    "Urząd Komisji Nadzoru Finansowego",
    "Urząd Ochrony Danych Osobowych",
    "Urząd Ochrony Konkurencji i Konsumentów",
    "Urząd Patentowy Rzeczypospolitej Polskiej",
    "Urząd Regulacji Energetyki",
    "Urząd Rejestracji Produktów Leczniczych",
    "Urząd Transportu Kolejowego",
    "Urząd Zamówień Publicznych",
    "Wody Polskie",
    "Wojewódzki Inspektorat Ochrony Środowiska",
    "Wojewódzki Sąd Administracyjny",
    "Zakład Ubezpieczeń Społecznych",
    "ZUS",
    "KRUS",
    "NFZ",
    "GUS",
    "UODO",
    "UOKiK",
    "KNF",
    "NIK",
    "RPO",
    "NSA",
    "SN",
    "TK",
    "EBC",
    "Unia Europejska",
]

_INFLECTED_PUBLIC_INSTITUTIONS = [
    "Komisji Europejskiej",
    "Komisją Europejską",
    "Parlamentu Europejskiego",
    "Parlamentem Europejskim",
    "Unii Europejskiej",
    "Radzie Unii Europejskiej",
    "Rady Unii Europejskiej",
    "Trybunału Sprawiedliwości Unii Europejskiej",
    "Trybunałem Sprawiedliwości Unii Europejskiej",
    "Naczelnego Sądu Administracyjnego",
    "Naczelnym Sądem Administracyjnym",
    "Sądu Najwyższego",
    "Sądem Najwyższym",
    "Trybunału Konstytucyjnego",
    "Trybunałem Konstytucyjnym",
    "Zakładu Ubezpieczeń Społecznych",
    "Zakładem Ubezpieczeń Społecznych",
    "Narodowego Funduszu Zdrowia",
    "Narodowym Funduszem Zdrowia",
    "Urzędu Ochrony Danych Osobowych",
    "Urzędem Ochrony Danych Osobowych",
    "Prezesem Urzędu Ochrony Danych Osobowych",
    "Prezesa Urzędu Ochrony Danych Osobowych",
]

_PUBLIC_PATTERNS = [
    re.compile(
        rf"\bMinisterstw(?:o|a|u|ie|em)\s+{_MINISTRY_TAIL_WORD}"
        rf"(?:\s+{_MINISTRY_TAIL_WORD}){{0,8}}",
    ),
    re.compile(
        rf"\bSąd(?:u|em|zie)?\s+"
        rf"(?:Rejonow(?:y|ego|ym)|Okręgow(?:y|ego|ym)|Apelacyjn(?:y|ego|ym))"
        rf"\s+(?:w|we|dla)\s+{_PLACE}",
        re.IGNORECASE,
    ),
    re.compile(
        rf"\bSąd(?:u|em|zie)?\s+"
        rf"(?:Rejonow(?:y|ego|ym)|Okręgow(?:y|ego|ym)|Apelacyjn(?:y|ego|ym))"
        rf"\s+{_PLACE}{_COURT_DEPARTMENT}",
        re.IGNORECASE,
    ),
    re.compile(
        rf"\bWojewódzk(?:i|iego|im)\s+Sąd(?:u|em|zie)?\s+Administracyjn(?:y|ego|ym)"
        rf"\s+w\s+{_PLACE}",
        re.IGNORECASE,
    ),
    re.compile(
        rf"\bProkuratur(?:a|y|ze|ą)\s+"
        rf"(?:Rejonow(?:a|ej|ą)|Okręgow(?:a|ej|ą)|Regionaln(?:a|ej|ą)|Krajow(?:a|ej|ą))"
        rf"(?:\s+w\s+{_PLACE})?",
        re.IGNORECASE,
    ),
    re.compile(
        rf"\bUrz(?:ąd|ędu|ędzie|ędem)\s+Skarbow(?:y|ego|ym)\s+w\s+{_PLACE}",
        re.IGNORECASE,
    ),
    re.compile(
        rf"\bUrz(?:ąd|ędu|ędzie|ędem)\s+(?:Miasta|Gminy|Marszałkowski|Wojewódzki)"
        rf"(?:\s+w)?\s+{_PLACE}",
        re.IGNORECASE,
    ),
    re.compile(
        rf"\bStarostw(?:o|a|ie|em)\s+Powiatow(?:e|ego|ym)(?:\s+w)?\s+{_PLACE}",
        re.IGNORECASE,
    ),
    re.compile(
        rf"\bKomend(?:a|y|zie|ą)\s+(?:Główn(?:a|ej|ą)|Wojewódzk(?:a|iej|ą)|"
        rf"Powiatow(?:a|ej|ą)|Miejsk(?:a|iej|ą))\s+"
        rf"(?:Policji|Państwowej\s+Straży\s+Pożarnej|Straży\s+Granicznej)"
        rf"(?:\s+w\s+{_PLACE})?",
        re.IGNORECASE,
    ),
]

_PHRASE_RE = re.compile(
    r"\b(?:"
    + "|".join(
        re.escape(phrase)
        for phrase in sorted(
            [*_CURATED_PUBLIC_INSTITUTIONS, *_INFLECTED_PUBLIC_INSTITUTIONS],
            key=len,
            reverse=True,
        )
    )
    + r")\b",
    re.IGNORECASE,
)

_LEMMA_PHRASES = {
    ("komisja", "europejski"),
    ("parlament", "europejski"),
    ("unia", "europejski"),
    ("rada", "unia", "europejski"),
    ("rada", "europejski"),
    ("trybunał", "sprawiedliwość", "unia", "europejski"),
    ("zakład", "ubezpieczenie", "społeczny"),
    ("narodowy", "fundusz", "zdrowie"),
    ("sąd", "najwyższy"),
    ("trybunał", "konstytucyjny"),
}


@dataclass(frozen=True)
class _Token:
    text: str
    idx: int
    lemma: str

    @property
    def end(self) -> int:
        return self.idx + len(self.text)


def detect_public_institutions(
    text: str,
    spacy_doc: Iterable[Any] | None = None,
) -> list[DetectedEntity]:
    """Detect non-sensitive public institutions and reject them by default."""
    entities: list[DetectedEntity] = []
    for match in _PHRASE_RE.finditer(text):
        start, end = _trim_span(text, match.start(), match.end())
        entities.append(_entity(text, start, end, confidence=0.95))
    for pattern in _PUBLIC_PATTERNS:
        for match in pattern.finditer(text):
            start, end = _trim_span(text, match.start(), match.end())
            entities.append(_entity(text, start, end, confidence=0.85))
    entities.extend(_detect_lemma_phrases(text, spacy_doc))
    return _dedupe(entities)


def curated_public_institution_count() -> int:
    return len(_CURATED_PUBLIC_INSTITUTIONS)


def _detect_lemma_phrases(
    text: str,
    spacy_doc: Iterable[Any] | None,
) -> list[DetectedEntity]:
    tokens = _tokens(spacy_doc)
    if not tokens:
        return []
    entities: list[DetectedEntity] = []
    lemmas = [_normalize(token.lemma) for token in tokens]
    for phrase in _LEMMA_PHRASES:
        size = len(phrase)
        for index in range(0, len(tokens) - size + 1):
            if tuple(lemmas[index : index + size]) == phrase:
                entities.append(
                    _entity(text, tokens[index].idx, tokens[index + size - 1].end, confidence=0.95)
                )
    return entities


def _tokens(spacy_doc: Iterable[Any] | None) -> list[_Token]:
    result: list[_Token] = []
    for token in spacy_doc or []:
        token_text = str(getattr(token, "text", ""))
        token_start = getattr(token, "idx", None)
        if token_start is None or not token_text or not any(char.isalpha() for char in token_text):
            continue
        result.append(
            _Token(
                text=token_text,
                idx=int(token_start),
                lemma=str(getattr(token, "lemma_", "") or token_text),
            )
        )
    return result


def _entity(text: str, start: int, end: int, confidence: float) -> DetectedEntity:
    value = text[start:end]
    return DetectedEntity(
        category=EntityCategory.PUBLIC_INSTITUTION,
        start=start,
        end=end,
        text=value,
        confidence=confidence,
        source="regex",
        validation=ValidationStatus.NOT_APPLICABLE,
        status=EntityStatus.REJECTED,
        entity_group_id=f"public:{_normalize(value)}",
        canonical_text=value.strip(),
    )


def _trim_span(text: str, start: int, end: int) -> tuple[int, int]:
    while start < end and text[start].isspace():
        start += 1
    while start < end and text[end - 1] in " \t\r\n.,;:":
        end -= 1
    return start, end


def _normalize(value: str) -> str:
    normalized = unicodedata.normalize("NFC", value)
    normalized = normalized.strip(" \t\r\n.,;:()[]{}\"'")
    return re.sub(r"\s+", " ", normalized.casefold())


def _dedupe(entities: list[DetectedEntity]) -> list[DetectedEntity]:
    selected: list[DetectedEntity] = []
    for entity in sorted(
        entities,
        key=lambda item: (-(item.end - item.start), -item.confidence, item.start),
    ):
        if any(_overlaps(entity, existing) for existing in selected):
            continue
        selected.append(entity)
    return sorted(selected, key=lambda item: (item.start, item.end))


def _overlaps(left: DetectedEntity, right: DetectedEntity) -> bool:
    return left.start < right.end and right.start < left.end
