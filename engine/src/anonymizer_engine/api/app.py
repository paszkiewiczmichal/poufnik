"""FastAPI application factory."""

from __future__ import annotations

import logging
import os
import sys
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Any

from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.utils import get_openapi
from starlette.concurrency import run_in_threadpool
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.base import RequestResponseEndpoint
from starlette.responses import Response

from anonymizer_engine import __version__
from anonymizer_engine.anonymize import anonymize, deanonymize, export_docx, export_pdf
from anonymizer_engine.api.config import config_file_path, get_config_dir, load_config
from anonymizer_engine.api.problems import (
    PayloadTooLarge,
    ProblemException,
    http_exception_handler,
    problem_exception_handler,
    problem_response,
    unhandled_exception_handler,
    validation_exception_handler,
)
from anonymizer_engine.api.schemas import (
    AnalyzeRequest,
    AnalyzeResponse,
    AnonymizeRequest,
    AnonymizeResponse,
    DeanonymizeRequest,
    DeanonymizeResponse,
    DocumentProcessResponse,
    ExportRequest,
    HealthResponse,
    InfoResponse,
    ProblemResponse,
    ProcessedDocument,
    PromptTemplateResponse,
    UsageResponse,
)
from anonymizer_engine.api.update_check import UpdateChecker
from anonymizer_engine.detection import EntityCategory, NerEngine, SpacyPresidioEngine, detect_all
from anonymizer_engine.detection.ner import spacy_model_available
from anonymizer_engine.licensing import BASIC_PLAN, Plan, UsageCounter
from anonymizer_engine.ocr import OcrError
from anonymizer_engine.parsers import ParserError, parse_document
from anonymizer_engine.parsers.models import Block, ParsedDocument
from anonymizer_engine.prompts import PromptLibrary, load_prompt_library

TEXT_LIMIT_BYTES = 10 * 1024 * 1024
FILE_LIMIT_BYTES = 100 * 1024 * 1024
API_KEY_HEADER = "x-api-key"
LOGGER = logging.getLogger(__name__)
DESKTOP_CORS_ORIGIN_REGEX = (
    r"^(tauri://localhost|https?://(tauri\.localhost|localhost|127\.0\.0\.1)(:\d+)?)$"
)
ALLOW_DEGRADED_ENV = "ANONYMIZER_ALLOW_DEGRADED"
DEGRADED_REASON = (
    "Default NER package pl_core_news_lg is unavailable; running deterministic "
    "and dictionary detection only."
)
_PROBLEM_SCHEMA = {"$ref": "#/components/schemas/ProblemResponse"}
_COMMON_PROBLEM_RESPONSES: dict[int, dict[str, Any]] = {
    400: {
        "description": "Bad request.",
        "content": {"application/problem+json": {"schema": _PROBLEM_SCHEMA}},
    },
    401: {
        "description": "Missing or invalid API key.",
        "content": {"application/problem+json": {"schema": _PROBLEM_SCHEMA}},
    },
    413: {
        "description": "Request payload exceeds the configured limit.",
        "content": {"application/problem+json": {"schema": _PROBLEM_SCHEMA}},
    },
    422: {
        "description": "Validation error.",
        "content": {"application/problem+json": {"schema": _PROBLEM_SCHEMA}},
    },
}
_EXPORT_RESPONSES: dict[int, dict[str, Any]] = {
    **_COMMON_PROBLEM_RESPONSES,
    200: {
        "description": "Anonymized document export.",
        "content": {
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
                "schema": {"type": "string", "format": "binary"}
            },
            "application/pdf": {"schema": {"type": "string", "format": "binary"}},
        },
    },
}


def create_app(
    *,
    api_key: str | None = None,
    require_auth: bool = True,
    config_dir: str | Path | None = None,
    reload_api_key_from_config: bool = False,
    plan: Plan = BASIC_PLAN,
    usage_counter: UsageCounter | None = None,
    prompt_library: PromptLibrary | None = None,
    ner_engine: NerEngine | None = None,
    update_checker: UpdateChecker | None = None,
    allow_degraded: bool | None = None,
) -> FastAPI:
    resolved_config_dir = Path(config_dir) if config_dir is not None else get_config_dir()
    config = load_config(resolved_config_dir)
    resolved_prompt_library = prompt_library or load_prompt_library(config.prompts_path)
    resolved_usage_counter = usage_counter or UsageCounter(resolved_config_dir / "usage.db")
    resolved_update_checker = update_checker or UpdateChecker.from_env(current_version=__version__)
    resolved_ner_engine, degraded_reason = _resolve_ner_engine(
        ner_engine,
        allow_degraded=allow_degraded,
    )

    app = FastAPI(
        title="Anonymizer Engine API",
        version=__version__,
        description="Offline API for document parsing, detection, and anonymization.",
        lifespan=_lifespan,
    )
    app.state.api_key = api_key
    app.state.config_dir = resolved_config_dir
    app.state.reload_api_key_from_config = reload_api_key_from_config
    app.state.require_auth = require_auth
    app.state.plan = plan
    app.state.usage_counter = resolved_usage_counter
    app.state.prompt_library = resolved_prompt_library
    app.state.ner_engine = resolved_ner_engine
    app.state.models_loaded = degraded_reason is None
    app.state.degraded_reason = degraded_reason
    app.state.update_checker = resolved_update_checker

    _install_exception_handlers(app)
    _install_middlewares(app)
    _install_routes(app)
    _install_openapi(app)
    return app


def _install_exception_handlers(app: FastAPI) -> None:
    app.add_exception_handler(ProblemException, problem_exception_handler)
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_exception_handler(ParserError, _domain_exception_handler)
    app.add_exception_handler(OcrError, _domain_exception_handler)
    app.add_exception_handler(ValueError, _value_error_handler)
    app.add_exception_handler(Exception, unhandled_exception_handler)


def _install_middlewares(app: FastAPI) -> None:
    @app.middleware("http")
    async def size_limit_middleware(
        request: Request,
        call_next: RequestResponseEndpoint,
    ) -> Response:
        limit = _request_size_limit(request.url.path)
        content_length = request.headers.get("content-length")
        if limit is None or request.method not in {"POST", "PUT", "PATCH"}:
            return await call_next(request)
        if content_length is None:
            # A body-bearing limited endpoint MUST declare its size. Without Content-Length
            # (e.g. a Transfer-Encoding: chunked stream) the pre-flight check could be
            # bypassed and the body buffered unbounded, so reject up front.
            return problem_response(
                status=411,
                title="Length Required",
                detail="Content-Length header is required for this endpoint.",
                instance=str(request.url.path),
            )
        try:
            request_size = int(content_length)
        except ValueError:
            return problem_response(
                status=400,
                title="Bad Request",
                detail="Invalid Content-Length header.",
                instance=str(request.url.path),
            )
        if request_size > limit:
            return problem_response(
                status=413,
                title="Payload Too Large",
                detail=_size_limit_detail(limit),
                instance=str(request.url.path),
            )
        return await call_next(request)

    @app.middleware("http")
    async def auth_middleware(request: Request, call_next: RequestResponseEndpoint) -> Response:
        if _requires_auth(request, app):
            expected = _current_api_key(app)
            provided = request.headers.get(API_KEY_HEADER)
            if not expected or provided != expected:
                return problem_response(
                    status=401,
                    title="Unauthorized",
                    detail="Missing or invalid API key.",
                    instance=str(request.url.path),
                )
        return await call_next(request)

    @app.middleware("http")
    async def usage_middleware(request: Request, call_next: RequestResponseEndpoint) -> Response:
        if not request.url.path.startswith("/v1/"):
            return await call_next(request)

        document_count = 1 if request.url.path == "/v1/documents/process" else 0
        check = app.state.usage_counter.check_limits(
            app.state.plan,
            request_count=1,
            document_count=document_count,
        )
        if not check.allowed:
            return problem_response(
                status=429,
                title="Too Many Requests",
                detail=check.reason or "Plan limit exceeded.",
                instance=str(request.url.path),
            )

        response = await call_next(request)
        if response.status_code < 400:
            app.state.usage_counter.increment(request.url.path, document_count)
        return response

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["null"],
        allow_origin_regex=DESKTOP_CORS_ORIGIN_REGEX,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type", "X-Api-Key"],
        expose_headers=["Content-Disposition"],
        max_age=86400,
    )


def _install_routes(app: FastAPI) -> None:
    @app.get("/v1/health", response_model=HealthResponse)
    async def health() -> HealthResponse:
        return HealthResponse(
            status="degraded" if app.state.degraded_reason else "ok",
            version=__version__,
            models_loaded=bool(app.state.models_loaded),
        )

    @app.get("/v1/info", response_model=InfoResponse)
    async def info() -> InfoResponse:
        update_snapshot = app.state.update_checker.snapshot()
        return InfoResponse(
            version=__version__,
            languages=["pl"],
            categories=[category.value for category in EntityCategory],
            plan=app.state.plan.model_dump(),
            license_status="active",
            update_available=update_snapshot.update_available,
            latest_version=update_snapshot.latest_version,
            degraded_reason=app.state.degraded_reason,
        )

    # NOTE: analyze/anonymize/deanonymize/export are declared as SYNC `def` on purpose.
    # FastAPI runs sync path operations in an external threadpool, so CPU-bound detection
    # (including user custom-rule regex, which is time-bounded) never blocks the event loop.
    @app.post("/v1/analyze", response_model=AnalyzeResponse)
    def analyze(request: AnalyzeRequest) -> AnalyzeResponse:
        _ensure_text_size(request.text)
        detection = _detect(request.text, request.language, app, request.custom_rules)
        return AnalyzeResponse(entities=detection.entities)

    @app.post("/v1/anonymize", response_model=AnonymizeResponse)
    def anonymize_endpoint(request: AnonymizeRequest) -> AnonymizeResponse:
        _ensure_text_size(request.text)
        entities = request.entities
        if entities is None:
            entities = _detect(request.text, request.language, app).entities
        result = anonymize(request.text, entities)
        return AnonymizeResponse(
            anonymized_text=result.anonymized_text,
            replacement_map=result.replacement_map,
            offset_map=result.offset_map,
        )

    @app.post("/v1/deanonymize", response_model=DeanonymizeResponse)
    def deanonymize_endpoint(request: DeanonymizeRequest) -> DeanonymizeResponse:
        _ensure_text_size(request.text)
        result = deanonymize(request.text, request.replacement_map)
        return DeanonymizeResponse(original_text=result.text, warnings=result.warnings)

    @app.post("/v1/export", response_class=Response, responses=_EXPORT_RESPONSES)
    def export_endpoint(request: ExportRequest) -> Response:
        _ensure_text_size(request.anonymized_text)
        parsed_doc = _export_parsed_document(request)
        if request.format == "docx":
            payload = export_docx(parsed_doc, request.anonymized_text)
            media_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        else:
            payload = export_pdf(parsed_doc, request.anonymized_text)
            media_type = "application/pdf"
        return Response(
            payload,
            media_type=media_type,
            headers={"Content-Disposition": f'attachment; filename="anonymized.{request.format}"'},
        )

    @app.post("/v1/documents/process", response_model=DocumentProcessResponse)
    async def process_document(
        file: Annotated[UploadFile, File()],
        force_ocr: Annotated[bool, Form()] = False,
        language: Annotated[str, Form()] = "pl",
    ) -> DocumentProcessResponse:
        data = await file.read()
        if len(data) > FILE_LIMIT_BYTES:
            raise PayloadTooLarge(_size_limit_detail(FILE_LIMIT_BYTES))
        # Offload the CPU-bound pipeline (parse + OCR + detection + anonymize) to a
        # worker thread so a slow document never blocks the event loop.
        return await run_in_threadpool(
            _process_document_sync,
            data,
            file.filename,
            force_ocr,
            language,
            app,
        )

    @app.get(
        "/v1/prompts",
        response_model=list[PromptTemplateResponse],
        responses=_COMMON_PROBLEM_RESPONSES,
    )
    async def list_prompts() -> list[PromptTemplateResponse]:
        return [
            PromptTemplateResponse.model_validate(template.model_dump())
            for template in app.state.prompt_library.templates
        ]

    @app.get(
        "/v1/prompts/{prompt_id}",
        response_model=PromptTemplateResponse,
        responses={
            **_COMMON_PROBLEM_RESPONSES,
            404: {
                "description": "Prompt template was not found.",
                "content": {"application/problem+json": {"schema": _PROBLEM_SCHEMA}},
            },
        },
    )
    async def get_prompt(prompt_id: str) -> PromptTemplateResponse:
        template = app.state.prompt_library.get(prompt_id)
        if template is None:
            raise ProblemException(404, "Not Found", f"Prompt {prompt_id!r} was not found.")
        return PromptTemplateResponse.model_validate(template.model_dump())

    @app.get("/v1/usage", response_model=UsageResponse)
    async def usage() -> UsageResponse:
        snapshot = app.state.usage_counter.current_period_snapshot()
        return UsageResponse.model_validate(snapshot.model_dump())


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncIterator[None]:
    app.state.update_checker.start()
    yield


def _install_openapi(app: FastAPI) -> None:
    def custom_openapi() -> dict[str, Any]:
        if app.openapi_schema:
            return app.openapi_schema
        schema = get_openapi(
            title=app.title,
            version=app.version,
            description=app.description,
            routes=app.routes,
        )
        components = schema.setdefault("components", {})
        schemas = components.setdefault("schemas", {})
        schemas["ProblemResponse"] = ProblemResponse.model_json_schema(
            ref_template="#/components/schemas/{model}"
        )
        security_schemes = components.setdefault("securitySchemes", {})
        security_schemes["ApiKeyAuth"] = {
            "type": "apiKey",
            "in": "header",
            "name": "X-Api-Key",
        }
        for path, operations in schema.get("paths", {}).items():
            if not path.startswith("/v1/"):
                continue
            for operation in operations.values():
                if isinstance(operation, dict):
                    operation.setdefault("security", [{"ApiKeyAuth": []}])
        app.openapi_schema = schema
        return app.openapi_schema

    app.openapi = custom_openapi  # type: ignore[method-assign]


def _process_document_sync(
    data: bytes,
    filename: str | None,
    force_ocr: bool,
    language: str,
    app: FastAPI,
) -> DocumentProcessResponse:
    parsed = parse_document(data, filename=filename, force_ocr=force_ocr)
    _ensure_text_size(parsed.text)
    detection = _detect(parsed.text, language, app)
    result = anonymize(parsed.text, detection.entities)
    return DocumentProcessResponse(
        document=ProcessedDocument(
            filename=filename or "document",
            format=parsed.format,
            source=parsed.source,
            page_count=parsed.page_count,
            text=parsed.text,
        ),
        entities=detection.entities,
        anonymized_text=result.anonymized_text,
        replacement_map=result.replacement_map,
        offset_map=result.offset_map,
    )


def _detect(
    text: str,
    language: str,
    app: FastAPI,
    custom_rules: list[dict[str, Any]] | None = None,
) -> Any:
    if language != "pl":
        raise ProblemException(
            400,
            "Bad Request",
            f"Unsupported language {language!r}; only 'pl' is supported.",
        )

    return detect_all(
        text,
        language=language,
        ner_engine=app.state.ner_engine,
        custom_rules=custom_rules,
    )


def _resolve_ner_engine(
    ner_engine: NerEngine | None,
    *,
    allow_degraded: bool | None,
) -> tuple[NerEngine, str | None]:
    if ner_engine is not None:
        return ner_engine, None

    if not _default_ner_package_available():
        return _degraded_or_raise(allow_degraded, DEGRADED_REASON, None)

    try:
        return _default_ner_engine(), None
    except Exception as exc:
        reason = f"Default NER engine is unavailable: {exc}"
        return _degraded_or_raise(allow_degraded, reason, exc)


def _degraded_or_raise(
    allow_degraded: bool | None,
    reason: str,
    exc: Exception | None,
) -> tuple[NerEngine, str]:
    if _allow_degraded(allow_degraded):
        _warn_ner_fallback(reason)
        return _DeterministicOnlyNer(), reason

    message = (
        "Cannot start Anonymizer Engine without the Polish NER model. "
        "Install pl_core_news_lg/Presidio assets or set "
        f"{ALLOW_DEGRADED_ENV}=true to run deterministic and dictionary detection only."
    )
    if exc is None:
        raise RuntimeError(message)
    raise RuntimeError(message) from exc


def _allow_degraded(allow_degraded: bool | None) -> bool:
    if allow_degraded is not None:
        return allow_degraded
    return os.environ.get(ALLOW_DEGRADED_ENV, "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def _warn_ner_fallback(message: str, exc: Exception | None = None) -> None:
    if exc is None:
        LOGGER.warning(message)
        print(f"WARNING {message}", file=sys.stderr, flush=True)
        return
    LOGGER.warning("%s: %s", message, exc)
    print(f"WARNING {message}: {exc}", file=sys.stderr, flush=True)


class _DeterministicOnlyNer:
    last_tokens: list[Any] = []

    def analyze(self, text: str, language: str) -> list[Any]:
        return []


@lru_cache(maxsize=1)
def _default_ner_engine() -> NerEngine:
    return SpacyPresidioEngine()


@lru_cache(maxsize=1)
def _default_ner_package_available() -> bool:
    return spacy_model_available()


def _requires_auth(request: Request, app: FastAPI) -> bool:
    if not app.state.require_auth:
        return False
    return request.url.path.startswith("/v1/")


def _current_api_key(app: FastAPI) -> str | None:
    if not app.state.reload_api_key_from_config:
        return app.state.api_key

    path = config_file_path(app.state.config_dir)
    if not path.exists():
        return app.state.api_key
    config = load_config(app.state.config_dir)
    if config.api_key:
        app.state.api_key = config.api_key
    return app.state.api_key


def _request_size_limit(path: str) -> int | None:
    if path == "/v1/documents/process":
        return FILE_LIMIT_BYTES
    if path.startswith("/v1/"):
        return TEXT_LIMIT_BYTES
    return None


def _ensure_text_size(text: str) -> None:
    if len(text.encode("utf-8")) > TEXT_LIMIT_BYTES:
        raise PayloadTooLarge(_size_limit_detail(TEXT_LIMIT_BYTES))


def _size_limit_detail(limit: int) -> str:
    size_mb = limit // (1024 * 1024)
    return f"Request payload exceeds the {size_mb} MB limit."


def _export_parsed_document(request: ExportRequest) -> ParsedDocument:
    blocks = request.blocks
    if not blocks:
        blocks = [Block(start=0, end=len(request.anonymized_text), kind="paragraph", page=1)]
    page_count = max((block.page or 1 for block in blocks), default=1)
    return ParsedDocument(
        text=request.anonymized_text,
        blocks=blocks,
        format="txt",
        has_text_layer=True,
        page_count=page_count,
    )


async def _domain_exception_handler(request: Request, exc: Exception) -> Response:
    return problem_response(
        status=400,
        title="Bad Request",
        detail=str(exc),
        instance=str(request.url.path),
    )


async def _value_error_handler(request: Request, exc: ValueError) -> Response:
    return problem_response(
        status=400,
        title="Bad Request",
        detail=str(exc),
        instance=str(request.url.path),
    )
