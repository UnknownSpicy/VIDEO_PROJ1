import html
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from .models import Cue, Transcript, UserError

MAX_CUES = 30_000
STAMP = r"\d{1,3}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?"
RANGE = re.compile(rf"^\s*({STAMP})\s*-->\s*({STAMP})(?:\s+.*)?$")


def youtube_id(url: str):
    try:
        parsed = urlparse(url.strip())
        if parsed.scheme != "https" or parsed.username or parsed.password:
            raise ValueError()
        host = parsed.hostname
        if host == "youtu.be":
            candidate = parsed.path.strip("/")
        elif host in {"youtube.com", "www.youtube.com", "m.youtube.com"}:
            if parsed.path == "/watch":
                candidate = parse_qs(parsed.query).get("v", [""])[0]
            elif parsed.path.startswith(("/shorts/", "/live/", "/embed/")):
                candidate = parsed.path.split("/")[2]
            else:
                raise ValueError()
        else:
            raise ValueError()
        if not re.fullmatch(r"[A-Za-z0-9_-]{11}", candidate):
            raise ValueError()
        return candidate
    except (ValueError, IndexError):
        raise UserError("Ange en giltig HTTPS-adress till en YouTube-video.") from None


def canonical_url(url):
    return "https://www.youtube.com/watch?v=" + youtube_id(url)


def seconds(stamp: str):
    parts = [float(x) for x in stamp.replace(",", ".").split(":")]
    if any(p < 0 for p in parts) or any(p >= 60 for p in parts[1:]):
        raise UserError("Transkriptet innehåller en ogiltig tidsstämpel.")
    result = 0.0
    for part in parts:
        result = result * 60 + part
    return result


def clean(text):
    text = re.sub(r"<[^>]*>", "", text)
    return re.sub(r"\s+", " ", html.unescape(text)).strip()


def parse_transcript(text: str, fmt="auto", source="manual") -> Transcript:
    if len(text) > 1_500_000:
        raise UserError("Transkriptet är för stort. Gränsen är 1,5 miljoner tecken.")
    text = text.lstrip("\ufeff").replace("\r\n", "\n").replace("\r", "\n")
    lines = text.splitlines()
    timed = any(RANGE.match(line) for line in lines)
    rows = []
    warnings = []
    if timed:
        i = 0
        while i < len(lines):
            match = RANGE.match(lines[i])
            if not match:
                i += 1
                continue
            start, end = map(seconds, match.groups())
            i += 1
            body = []
            while i < len(lines) and lines[i].strip() and not RANGE.match(lines[i]):
                body.append(lines[i])
                i += 1
            value = clean(" ".join(body))
            if end <= start:
                raise UserError("Transkriptets sluttider måste vara efter starttiderna.")
            if value:
                rows.append([start, end, value])
    else:
        # Plain text still needs explicit anchors; never manufacture timing.
        pattern = re.compile(rf"^\s*\[?({STAMP})\]?\s+(.+)$")
        for line in lines:
            if not line.strip():
                continue
            match = pattern.match(line)
            if not match:
                raise UserError("Manuell text måste ha tidsstämplar på varje rad. Använd SRT/VTT eller '00:12 Text'. Sista raden kan vara en tom slutmarkör, t.ex. '01:30 [END]'.")
            rows.append([seconds(match[1]), None, clean(match[2])])
        for i, row in enumerate(rows[:-1]):
            row[1] = rows[i + 1][0]
        if rows:
            # A final point anchor supplies no known end; exclude it, never guess.
            rows.pop()
            warnings.append("Textformat: sista tidsraden används som slutmarkör. Varje rad slutar vid nästa tidsstämpel; använd SRT/VTT för exakta sluttider.")
    if not rows:
        raise UserError("Inga tidsatta transkriptavsnitt hittades. Ladda upp SRT/VTT eller klistra in tidsatt text.")
    if len(rows) > MAX_CUES:
        raise UserError(f"Transkriptet har för många avsnitt (max {MAX_CUES}).")
    if any(row[1] <= row[0] for row in rows) or any(rows[i][0] > rows[i + 1][0] for i in range(len(rows) - 1)):
        raise UserError("Tidsstämplarna måste vara i stigande ordning och sluttiden måste vara efter start.")
    # YouTube automatic VTT often rolls the previous words into the next cue.
    normalized = []
    removed = False
    for start, end, value in rows:
        if normalized and start < normalized[-1][1] and value == normalized[-1][2]:
            normalized[-1][1] = max(end, normalized[-1][1])
            removed = True
            continue
        if normalized and start < normalized[-1][1]:
            previous_words = normalized[-1][2].split()
            words = value.split()
            overlap = 0
            for size in range(min(len(previous_words), len(words)), 0, -1):
                if previous_words[-size:] == words[:size]:
                    overlap = size
                    break
            if overlap:
                value = " ".join(words[overlap:])
                removed = True
        if value:
            normalized.append([start, end, value])
    if removed:
        warnings.append("Överlappande upprepningar i automatiska undertexter har normaliserats. Kontrollera klippgränser mot originalvideon.")
    cues = [Cue(id=f"c{i:05d}", start=row[0], end=row[1], text=row[2]) for i, row in enumerate(normalized)]
    return Transcript(cues=cues, source=source, warnings=warnings)


def run_ytdlp(args: list[str], timeout=120):
    try:
        runtime = ["--js-runtimes", "node"] if shutil.which("node") else []
        result = subprocess.run([sys.executable, "-m", "yt_dlp", "--ignore-config", "--no-playlist",
                                 "--no-progress", "--quiet", "--socket-timeout", "20",
                                 "--retries", "2", "--fragment-retries", "2", "--extractor-retries", "2", *runtime, *args], capture_output=True, text=True,
                                encoding="utf-8", errors="replace", timeout=timeout, check=False)
    except subprocess.TimeoutExpired:
        raise UserError("YouTube-förfrågan tog för lång tid. Försök igen eller använd manuellt transkript.") from None
    if result.returncode:
        # yt-dlp output may include signed URLs or environment details; keep it local.
        raise UserError("YouTube kunde inte hämtas med yt-dlp. Videon kan vara privat, åldersbegränsad eller blockerad av YouTube. Prova SRT/VTT eller manuellt transkript.")
    return result.stdout


def retrieve(url: str) -> Transcript:
    import json
    canonical = canonical_url(url)
    metadata = json.loads(run_ytdlp(["--skip-download", "--dump-single-json", canonical]))
    available = metadata.get("subtitles", {})
    automatic = metadata.get("automatic_captions", {})
    chosen = next(((language, auto) for auto, pool in ((False, available), (True, automatic))
                   for preferred in ("sv", "en", "en-orig", "*")
                   for language in pool if language != "live_chat" and (language == preferred or preferred == "*")), None)
    if not chosen:
        raise UserError("Videon saknar tillgängliga undertexter. Ladda upp SRT/VTT eller klistra in ett tidsatt transkript.")
    language, auto = chosen
    with tempfile.TemporaryDirectory(prefix="creatoriq-subs-") as directory:
        run_ytdlp(["--skip-download", "--write-auto-subs" if auto else "--write-subs",
                   "--sub-langs", language, "--sub-format", "vtt", "--paths", directory,
                   "-o", "source.%(ext)s", canonical])
        files = list(Path(directory).glob("*.vtt"))
        if not files:
            raise UserError("Undertexterna kunde inte sparas. Använd manuell inmatning eller SRT/VTT.")
        if files[0].stat().st_size > 6_000_000:
            raise UserError("Undertextfilen är för stor för V1.")
        transcript = parse_transcript(files[0].read_text(encoding="utf-8"), source="youtube-auto" if auto else "youtube")
    transcript.language = language
    transcript.title = metadata.get("title", "YouTube-video")
    return transcript
