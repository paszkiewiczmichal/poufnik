"""RFC 7807 problem responses."""

from __future__ import annotations

import json
from typing import Any

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

PROBLEM_JSON = "application/problem+json"


class ProblemException(Exception):
    def __init__(
        self,
        status: int,
        title: str,
        detail: str,
        *,
        type_: str = "about:blank",
    ) -> None:
        self.status = status
        self.title = title
        self.detail = detail
        self.type = type_
        super().__init__(detail)


class PayloadTooLarge(ProblemException):
    def __init__(self, detail: str) -> None:
        super().__init__(413, "Payload Too Large", detail)


def problem_response(
    *,
    status: int,
    title: str,
    detail: str,
    instance: str | None = None,
    type_: str = "about:blank",
    extra: dict[str, Any] | None = None,
) -> JSONResponse:
    payload: dict[str, Any] = {
        "type": type_,
        "title": title,
        "status": status,
        "detail": detail,
    }
    if instance is not None:
        payload["instance"] = instance
    if extra:
        payload.update(extra)
    return JSONResponse(payload, status_code=status, media_type=PROBLEM_JSON)


async def problem_exception_handler(request: Request, exc: ProblemException) -> JSONResponse:
    return problem_response(
        status=exc.status,
        title=exc.title,
        detail=exc.detail,
        instance=str(request.url.path),
        type_=exc.type,
    )


async def http_exception_handler(
    request: Request,
    exc: StarletteHTTPException,
) -> JSONResponse:
    detail = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
    return problem_response(
        status=exc.status_code,
        title=_default_title(exc.status_code),
        detail=detail,
        instance=str(request.url.path),
    )


async def validation_exception_handler(
    request: Request,
    exc: RequestValidationError,
) -> JSONResponse:
    return problem_response(
        status=422,
        title="Validation Error",
        detail="Request validation failed.",
        instance=str(request.url.path),
        extra={"errors": _jsonable(exc.errors())},
    )


async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    return problem_response(
        status=500,
        title="Internal Server Error",
        detail="An unexpected error occurred.",
        instance=str(request.url.path),
    )


def _default_title(status: int) -> str:
    titles = {
        400: "Bad Request",
        401: "Unauthorized",
        404: "Not Found",
        405: "Method Not Allowed",
        413: "Payload Too Large",
        415: "Unsupported Media Type",
        422: "Validation Error",
        429: "Too Many Requests",
    }
    return titles.get(status, "HTTP Error")


def _jsonable(value: Any) -> Any:
    try:
        json.dumps(value)
    except TypeError:
        if isinstance(value, dict):
            return {key: _jsonable(item) for key, item in value.items()}
        if isinstance(value, list):
            return [_jsonable(item) for item in value]
        return str(value)
    return value
