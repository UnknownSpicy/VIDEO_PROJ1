import asyncio
import os
import secrets
import shutil
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, ValidationError
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .credentials import Credentials
from .models import AnalysisRequest, ClipEdit, UserError
from .openrouter import OpenRouter
from .service import AnalysisService
from .storage import Store
from .transcripts import canonical_url

ROOT = Path(__file__).parent


def create_app(data_dir=None, router=None, credentials=None, transcript_provider=None, vision=None):
    data_dir = Path(data_dir or os.environ.get("CREATORIQ_DATA_DIR", Path.home() / ".creatoriq"))
    store = Store(data_dir / "creatoriq.sqlite3")
    credentials = credentials or Credentials()
    router = router or OpenRouter()
    options = dict(transcript_provider=transcript_provider) if transcript_provider else {}
    service = AnalysisService(store, router, credentials, vision=vision, **options)
    pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="creatoriq")
    active = set()
    csrf = secrets.token_urlsafe(32)

    @asynccontextmanager
    async def lifespan(app):
        yield
        pool.shutdown(wait=True, cancel_futures=True)

    app = FastAPI(title="CreatorIQ", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.state.store, app.state.service = store, service
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=["localhost", "127.0.0.1", "[::1]", "testserver"])

    @app.middleware("http")
    async def local_security(request: Request, call_next):
        # Protect the local key/settings API from other sites, even on localhost.
        if request.method not in {"GET", "HEAD", "OPTIONS"}:
            if not secrets.compare_digest(request.headers.get("x-creatoriq-token", ""), csrf):
                return JSONResponse({"detail": "Sidan måste laddas om innan ändringar kan göras."}, status_code=403)
        if request.url.path.startswith("/api/"):
            length = request.headers.get("content-length")
            if length:
                try:
                    if int(length) > 7_000_000:
                        return JSONResponse({"detail": "Förfrågan är för stor (max 7 MB)."}, status_code=413)
                except ValueError:
                    return JSONResponse({"detail": "Ogiltig förfrågan."}, status_code=400)
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.exception_handler(UserError)
    async def user_error(request, error):
        return JSONResponse({"detail": str(error)}, status_code=400)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, error):
        # FastAPI defaults may echo submitted API keys in validation input fields.
        return JSONResponse({"detail": "Kontrollera inmatningen. Ett fält saknas eller har ett ogiltigt värde."}, status_code=422)

    @app.get("/api/status")
    def status():
        return dict(configured=bool(credentials.get()), secure_key_storage=credentials.secure_backend,
                    ffmpeg=bool(shutil.which("ffmpeg")),
                    youtube_js_runtime=bool(shutil.which("node") or shutil.which("deno")), csrf_token=csrf)

    class KeyInput(BaseModel):
        key: str = Field(min_length=1, max_length=1000)
        persist: bool = False

    @app.post("/api/key")
    def save_key(payload: KeyInput):
        credentials.set(payload.key, payload.persist)
        return {"configured": True}

    @app.delete("/api/key")
    def delete_key():
        return credentials.clear()

    @app.get("/api/models")
    def models(refresh: bool = False):
        return {"models": router.models(refresh=refresh)}

    @app.get("/api/analyses")
    def history():
        return {"analyses": store.list()}

    @app.post("/api/analyses", status_code=202)
    async def analyze(request: Request):
        if not credentials.get():
            raise UserError("Lägg först till en OpenRouter API-nyckel i inställningarna.")
        # Bound multipart parser and uploaded file reads, not only Content-Length.
        async with request.form(max_files=1, max_fields=12, max_part_size=6_000_000) as form:
            values = {k: v for k, v in form.items() if k != "file"}
            upload = form.get("file")
            if upload and getattr(upload, "filename", ""):
                extension = Path(upload.filename).suffix.lower()
                if extension not in {".srt", ".vtt"}:
                    raise UserError("Ladda upp en SRT- eller VTT-fil.")
                contents = await upload.read(6_000_001)
                if len(contents) > 6_000_000:
                    raise UserError("Undertextfilen är för stor (max 6 MB).")
                try:
                    values["transcript_text"] = contents.decode("utf-8-sig")
                except UnicodeDecodeError:
                    raise UserError("Undertextfilen måste vara UTF-8-kodad.") from None
                values["transcript_format"] = extension[1:]
            try:
                payload = AnalysisRequest.model_validate(values)
            except ValidationError:
                raise UserError("Kontrollera instruktioner, analysläge och antal klipp.") from None
        if payload.youtube_url:
            canonical_url(payload.youtube_url)
        if not payload.youtube_url and not payload.transcript_text.strip():
            raise UserError("Ange en YouTube-adress eller ett tidsatt transkript.")
        # No unbounded queue of expensive upstream calls.
        if len(active) >= 2:
            raise UserError("Två analyser körs redan. Vänta tills en är klar.")
        saved_request = payload.model_dump(exclude={"transcript_text"})
        data = store.create(saved_request)
        active.add(data["id"])
        future = asyncio.get_running_loop().run_in_executor(pool, service.run, data["id"], payload)
        future.add_done_callback(lambda _: active.discard(data["id"]))
        return {"id": data["id"]}

    @app.get("/api/analyses/{identifier}")
    def result(identifier: str):
        return store.get(identifier)

    @app.patch("/api/analyses/{identifier}/clips/{mode}/{clip_id}")
    def edit(identifier: str, mode: str, clip_id: str, payload: ClipEdit):
        return service.edit(identifier, mode, clip_id, payload)

    @app.get("/api/analyses/{identifier}/export")
    def export(identifier: str, selected_only: bool = False):
        data = store.get(identifier)
        if data["status"] != "done":
            raise UserError("Endast färdiga analyser kan exporteras.")
        if selected_only:
            for result in data["results"]:
                result["clips"] = [c for c in result["clips"] if c["status"] == "selected"]
        return JSONResponse({"schema_version": 1, "engagement_note": "Subjektiv AI-bedömning, inte uppmätt engagemang.", **data},
                            headers={"Content-Disposition": f'attachment; filename="creatoriq-{data["id"]}.json"'})

    @app.get("/")
    def index():
        return FileResponse(ROOT / "static" / "index.html")

    app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")
    return app
