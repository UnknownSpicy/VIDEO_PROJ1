import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from .models import UserError


def now():
    return datetime.now(timezone.utc).isoformat()


class Store:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        with self.connect() as db:
            db.execute("CREATE TABLE IF NOT EXISTS analyses (id TEXT PRIMARY KEY, data TEXT NOT NULL)")
            # A published snapshot retains data, never live worker threads.
            for row in db.execute("SELECT id, data FROM analyses").fetchall():
                data = json.loads(row[1])
                if data["status"] in ("queued", "running"):
                    data.update(status="error", error="Analysen avbröts när servern startades om. Starta en ny analys.")
                    db.execute("UPDATE analyses SET data=? WHERE id=?", (json.dumps(data), row[0]))

    def connect(self):
        return sqlite3.connect(self.path, timeout=15)

    def create(self, request: dict):
        identifier = uuid4().hex
        data = dict(id=identifier, created_at=now(), updated_at=now(), status="queued",
                    progress="Väntar på analys", request=request, results=[], warnings=[], error=None)
        with self.connect() as db:
            db.execute("INSERT INTO analyses VALUES (?, ?)", (identifier, json.dumps(data)))
        return data

    def get(self, identifier: str):
        with self.connect() as db:
            row = db.execute("SELECT data FROM analyses WHERE id=?", (identifier,)).fetchone()
        if row is None:
            raise UserError("Analysen finns inte.")
        return json.loads(row[0])

    def update(self, identifier: str, **changes):
        # A transaction prevents worker progress updates from losing review edits.
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT data FROM analyses WHERE id=?", (identifier,)).fetchone()
            if row is None:
                raise UserError("Analysen finns inte.")
            data = json.loads(row[0])
            data.update(changes, updated_at=now())
            db.execute("UPDATE analyses SET data=? WHERE id=?", (json.dumps(data), identifier))
        return data

    def list(self):
        with self.connect() as db:
            rows = db.execute("SELECT data FROM analyses ORDER BY rowid DESC LIMIT 100").fetchall()
        return [dict(id=d["id"], created_at=d["created_at"], status=d["status"],
                     title=d.get("transcript", {}).get("title", "Analys"), mode=d["request"]["mode"])
                for row in rows if (d := json.loads(row[0]))]
