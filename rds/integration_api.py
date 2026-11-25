# FE 설문 쓰기와 지표 조회를 인증한 뒤 제한된 RDS 함수로 전달한다.
from datetime import date
import hmac
import os
from typing import Annotated, Literal
from uuid import UUID

from fastapi import FastAPI, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, ValidationError
import psycopg
from psycopg.types.json import Jsonb
from starlette.concurrency import run_in_threadpool

MAX_BODY_BYTES = 4_500_000
MAX_BIGINT = 9223372036854775807
BigIntId = Annotated[int, Field(strict=True, ge=1, le=MAX_BIGINT)]


class Survey(BaseModel):
    model_config = ConfigDict(extra="forbid")
    user_id: BigIntId
    survey: Literal["general", "paid"]
    response_id: UUID | None = None
    completed: bool = Field(strict=True)
    email: str | None = None
    answers: dict[str, str | int | float | list[str]]


class Metrics(BaseModel):
    model_config = ConfigDict(extra="forbid")
    target_date: date
    excluded_ids: list[BigIntId] = Field(max_length=1000)


def database_call(dsn, statement, fields):
    try:
        with psycopg.connect(dsn, connect_timeout=3, sslmode="verify-full",
                             options="-c statement_timeout=5000") as connection:
            return connection.execute(statement, fields).fetchone()[0]
    except psycopg.Error:
        raise HTTPException(503, "database request failed") from None


async def read_request(request, expected_token, payload_type):
    supplied = request.headers.get("authorization", "")
    if not hmac.compare_digest(supplied.encode(), f"Bearer {expected_token}".encode()):
        raise HTTPException(401, "unauthorized")
    body = bytearray()
    async for chunk in request.stream():
        if len(chunk) + len(body) > MAX_BODY_BYTES:
            raise HTTPException(413, "request too large")
        body.extend(chunk)
    try:
        return payload_type.model_validate_json(body)
    except ValidationError:
        raise HTTPException(400, "invalid request") from None


def create_app(env=None, execute=database_call):
    if env is None:
        env = os.environ
    survey_token = env["LANDIT_SURVEY_RDS_TOKEN"]
    metrics_token = env["LANDIT_METRICS_RDS_TOKEN"]
    survey_dsn = env["LANDIT_SURVEY_RDS_DSN"]
    metrics_dsn = env["LANDIT_METRICS_RDS_DSN"]
    if not all((survey_token, metrics_token, survey_dsn, metrics_dsn)) or survey_token == metrics_token:
        raise RuntimeError("separate survey and metrics credentials are required")

    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

    @app.post("/internal/rds/survey", status_code=204)
    async def save_survey(request: Request):
        data = await read_request(request, survey_token, Survey)
        result = await run_in_threadpool(
            execute, survey_dsn,
            "SELECT landit_integration.save_survey(%s::bigint,%s::text,%s::uuid,%s::boolean,%s::text,%s::jsonb)",
            (data.user_id, data.survey, data.response_id, data.completed, data.email, Jsonb(data.answers)),
        )
        if result in ("user_missing", "response_conflict"):
            raise HTTPException(409, result)
        if result != "saved":
            raise HTTPException(400, "invalid survey")
        return Response(status_code=204)

    @app.post("/internal/rds/metrics")
    async def read_metrics(request: Request):
        data = await read_request(request, metrics_token, Metrics)
        return await run_in_threadpool(
            execute, metrics_dsn,
            "SELECT public.metrics_records(%s::date, %s::bigint[])",
            (data.target_date, data.excluded_ids),
        )

    return app
