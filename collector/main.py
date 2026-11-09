import json
import os
import re
import sqlite3
import uuid
from contextlib import asynccontextmanager
from typing import Any
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from fastapi import FastAPI, HTTPException

DB_PATH = os.getenv("DB_PATH", "/data/events.db")

def initialize_database():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)

    with sqlite3.connect(DB_PATH) as connection:
        connection.execute("""
            CREATE TABLE IF NOT EXISTS events (
                id TEXT PRIMARY KEY,
                sensor TEXT,
                eventid TEXT,
                timestamp TEXT,
                payload TEXT NOT NULL
            )
        """)

def sanitize_event(event: dict[str, Any]) -> dict[str, Any]:
    sanitized = event.copy()

    # Remove credenciais e chaves públicas do registro.
    sanitized.pop("password", None)
    sanitized.pop("key", None)

    # Redige possíveis senhas reproduzidas na mensagem.
    if isinstance(sanitized.get("message"), str):
        sanitized["message"] = re.sub(
            r"(\[[^/\]]+/)[^\]]+(\])",
            r"\1[REDACTED]\2",
            sanitized["message"],
        )
    return sanitized

@asynccontextmanager
async def lifespan(app: FastAPI):
    initialize_database()
    yield

app = FastAPI(
    title="Honeynet Event Collector",
    description="API central para coleta de eventos dos sensores Cowrie",
    version="1.0.0",
    lifespan=lifespan,
)

app.mount(
    "/static",
    StaticFiles(directory="static"),
    name="static",
)

@app.get("/")
def dashboard():
    return FileResponse("static/index.html")

@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/events")
def receive_event(event: dict[str, Any]):
    if not event:
        raise HTTPException(
            status_code=400,
            detail="Evento vazio",
        )
    sanitized = sanitize_event(event)
    event_id = str(uuid.uuid4())
    sensor = sanitized.get("sensor")
    event_type = sanitized.get("eventid")
    timestamp = sanitized.get("timestamp")
    payload = json.dumps(sanitized)

    try:
        with sqlite3.connect(DB_PATH) as connection:
            connection.execute(
                """
                INSERT INTO events
                (id, sensor, eventid, timestamp, payload)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    event_id,
                    sensor,
                    event_type,
                    timestamp,
                    payload,
                ),
            )
    except sqlite3.Error:
        raise HTTPException(
            status_code=500,
            detail="Erro ao armazenar evento",
        )

    return {
        "status": "received",
        "event_id": event_id,
    }

@app.get("/events")
def list_events(limit: int = 100):
    if limit < 1 or limit > 1000:
        raise HTTPException(
            status_code=400,
            detail="O limite deve estar entre 1 e 1000",
        )

    with sqlite3.connect(DB_PATH) as connection:
        connection.row_factory = sqlite3.Row
        rows = connection.execute(
            """
            SELECT id, sensor, eventid, timestamp, payload
            FROM events
            ORDER BY rowid DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    return [
        {
            "id": row["id"],
            "sensor": row["sensor"],
            "eventid": row["eventid"],
            "timestamp": row["timestamp"],
            "payload": json.loads(row["payload"]),
        }
        for row in rows
    ]
