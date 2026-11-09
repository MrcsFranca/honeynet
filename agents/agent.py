import json
import os
import re
import time
from pathlib import Path

import requests

LOG_PATH = Path(os.getenv("LOG_PATH", "/logs/log/cowrie/cowrie.json"))
STATE_PATH = Path(os.getenv("STATE_PATH", "/state/offset"))
COLLECTOR_URL = os.getenv(
    "COLLECTOR_URL",
    "http://collector:8000/events",
)

RETRY_INTERVAL = 5

def load_offset():
    if not STATE_PATH.exists():
        return 0

    return int(STATE_PATH.read_text().strip() or "0")

def save_offset(offset):
    temporary_path = STATE_PATH.with_suffix(".tmp")
    temporary_path.write_text(str(offset))
    temporary_path.replace(STATE_PATH)

def sanitize_event(event):
    sanitized = event.copy()

    sanitized.pop("password", None)
    sanitized.pop("key", None)

    if isinstance(sanitized.get("message"), str):
        sanitized["message"] = re.sub(
            r"(\[[^/\]]+/)[^\]]+(\])",
            r"\1[REDACTED]\2",
            sanitized["message"],
        )

    return sanitized

def send_event(event):
    sanitized = sanitize_event(event)

    response = requests.post(
        COLLECTOR_URL,
        json=sanitized,
        timeout=10,
    )

    response.raise_for_status()

    print(
        f"Evento enviado: {event.get('eventid')} "
        f"| confirmação: {response.status_code}",
        flush=True,
    )

def main():
    print(f"Agente iniciado. Monitorando: {LOG_PATH}", flush=True)

    while not LOG_PATH.exists():
        print("Arquivo de log ainda não existe. Aguardando...", flush=True)
        time.sleep(RETRY_INTERVAL)

    offset = load_offset()

    while True:
        try:
            with LOG_PATH.open("rb") as log_file:
                log_file.seek(0, os.SEEK_END)

                if offset > log_file.tell():
                    print("Log foi truncado. Reiniciando leitura.", flush=True)
                    offset = 0
                    save_offset(offset)

                log_file.seek(offset)

                while True:
                    line = log_file.readline()

                    if not line:
                        break

                    # Aguarda uma linha completa.
                    if not line.endswith(b"\n"):
                        break

                    next_offset = log_file.tell()

                    try:
                        event = json.loads(line)
                    except json.JSONDecodeError:
                        print("Linha JSON inválida. Ignorando.", flush=True)
                        offset = next_offset
                        save_offset(offset)
                        continue

                    try:
                        send_event(event)

                    except requests.RequestException as error:
                        print(
                            f"Falha no envio: {error}. "
                            "O evento será tentado novamente.",
                            flush=True,
                        )
                        break

                    # Só avança depois da confirmação do coletor.
                    offset = next_offset
                    save_offset(offset)

        except OSError as error:
            print(f"Erro ao acessar o log: {error}", flush=True)

        time.sleep(1)

if __name__ == "__main__":
    main()
