import html
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from .models import Cue, Transcript, UntimedTail, UserError

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
    untimed_tail = None
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
        if any(rows[i][0] > rows[i + 1][0] for i in range(len(rows) - 1)):
            rows.sort(key=lambda row: (row[0], row[1]))
            warnings.append("Undertextavsnitten låg inte i tidsordning och har sorterats efter sina befintliga tidsstämplar. Inga tider har ändrats.")
    else:
        # Plain text still needs explicit anchors; never manufacture timing.
        pattern = re.compile(rf"^\s*\[?({STAMP})\]?\s+(.+)$")
        merged = False
        for line_number, line in enumerate(lines, 1):
            if not line.strip():
                continue
            match = pattern.match(line)
            if not match:
                raise UserError("Manuell text måste ha tidsstämplar på varje rad. Använd SRT/VTT eller '00:12 Text'. Sista raden kan vara en tom slutmarkör, t.ex. '01:30 [END]'.")
            start, value = seconds(match[1]), clean(match[2])
            if rows and start < rows[-1][0]:
                raise UserError(f"Tidsstämpeln {match[1]} på rad {line_number} ligger före föregående tidsstämpel. Rätta ordningen; lika tidsstämplar är tillåtna.")
            if rows and start == rows[-1][0]:
                rows[-1][2] = clean(rows[-1][2] + " " + value)
                merged = True
            else:
                rows.append([start, None, value])
        if merged:
            warnings.append("Rader med samma tidsstämpel har slagits ihop i textordning. Avsnittet slutar vid nästa senare tidsstämpel.")
        for i, row in enumerate(rows[:-1]):
            row[1] = rows[i + 1][0]
        if rows:
            # A marker after speech does not supply an end time for that speech.
            last = rows.pop()
            tail_text = re.sub(r'\s*\[END\][\s"\u201d\u2019\u0027]*$', '', last[2], flags=re.IGNORECASE).strip()
            if tail_text:
                untimed_tail = UntimedTail(start=last[0], text=tail_text)
                warnings.append("Sista tidsraden innehåller dialog utan känd sluttid. Dialogen behålls som sammanhang för AI:n men kan inte väljas som klipp. Lägg en senare tidsstämpel med [END] på en egen rad för att även kunna klippa slutdialogen. Ingen sluttid har gissats.")
            warnings.append("Textformat: varje rad slutar vid nästa senare tidsstämpel. Använd SRT/VTT för explicita sluttider.")
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
    return Transcript(cues=cues, source=source, warnings=warnings, untimed_tail=untimed_tail)


def youtube_error(stderr: str) -> str:
    """Classify known failures without exposing URLs, tokens or local paths."""
    error = stderr.casefold()
    fallback = " Ladda upp SRT/VTT eller använd ett manuellt tidsatt transkript."
    if "no module named yt_dlp" in error:
        return "yt-dlp saknas i installationen. Starta om med start.bat för att installera beroendena."
    if "unable to connect to proxy" in error or "tunnel connection failed" in error:
        return "Anslutningen till YouTube stoppades av en proxy. Kontrollera nätverkets proxy- och brandväggsinställningar." + fallback
    if "certificate_verify_failed" in error or "certificate verify failed" in error:
        return "YouTubes TLS-certifikat kunde inte verifieras. Kontrollera datorns datum och nätverkets certifikatkonfiguration. Certifikatkontrollen har inte stängts av." + fallback
    if "not a bot" in error or "confirm you're not a bot" in error:
        return "YouTube kräver en inloggnings-/botkontroll för hämtningen. Att videon fungerar i webbläsaren garanterar inte åtkomst via yt-dlp. Ingen inloggning eller cookieimport sker automatiskt." + fallback
    if "private video" in error or "members-only" in error or "join this channel" in error:
        return "YouTube anger att videon är privat eller kräver medlemskap. Prova en offentlig video." + fallback
    if "confirm your age" in error or "age-restricted" in error or "age restricted" in error:
        return "YouTube kräver åldersverifiering för den här videon. Prova en video utan åldersgräns." + fallback
    if "not available in your country" in error or "geo-restricted" in error:
        return "YouTube anger att videon inte är tillgänglig i din region." + fallback
    if "429" in error or "too many requests" in error:
        return "YouTube begränsar antalet förfrågningar. Vänta en stund innan du försöker igen." + fallback
    if "403" in error or "forbidden" in error:
        return "YouTube nekade hämtningen (HTTP 403). Det kan bero på YouTubes åtkomstkontroller eller nätverket; en saknad undertext är inte fastställd." + fallback
    if any(marker in error for marker in ("no supported javascript runtime", "javascript runtime is unavailable",
                                          "signature extraction failed", "challenge solving failed")):
        return "yt-dlp kunde inte lösa YouTubes JavaScript-kontroll. Installera aktuell Node.js LTS (minst version 22), stäng servern och starta start.bat i en ny terminal. Kontrollera även att yt-dlp:s EJS-komponent är installerad." + fallback
    if "requested format is not available" in error or "no video formats" in error:
        return "YouTube lämnade inget användbart videoformat. Det kan bero på videons åtkomstkrav eller en misslyckad JavaScript-kontroll. Transkriptläget försöker hämta undertexter oberoende av videoformat." + fallback
    if "video unavailable" in error or "video has been removed" in error:
        return "YouTube anger att videon är otillgänglig eller borttagen. Kontrollera länken och prova en annan offentlig video." + fallback
    if any(marker in error for marker in ("timed out", "name resolution", "getaddrinfo failed", "network is unreachable")):
        return "Nätverksanslutningen till YouTube misslyckades. Kontrollera anslutningen och försök igen." + fallback
    return "yt-dlp kunde inte hämta YouTube-resursen och orsaken kunde inte identifieras. Kör felsökningskommandot i README för mer information." + fallback


def run_ytdlp(args: list[str], timeout=120):
    try:
        runtime = ["--js-runtimes", "node"] if shutil.which("node") else []
        result = subprocess.run([sys.executable, "-m", "yt_dlp", "--ignore-config", "--no-playlist",
                                 "--no-progress", "--quiet", "--socket-timeout", "20",
                                 "--retries", "2", "--fragment-retries", "2", "--extractor-retries", "2", *runtime, *args], capture_output=True, text=True,
                                encoding="utf-8", errors="replace", timeout=timeout, check=False)
    except subprocess.TimeoutExpired:
        raise UserError("YouTube-förfrågan tog för lång tid. Försök igen eller använd manuellt transkript.") from None
    except OSError:
        raise UserError("yt-dlp kunde inte startas. Kontrollera Python-installationen och starta om med start.bat.") from None
    if result.returncode:
        # Never return raw stderr: it can contain signed URLs or environment details.
        raise UserError(youtube_error(result.stderr))
    return result.stdout


def subtitle_candidates(metadata: dict) -> list[tuple[str, bool]]:
    """Prefer source speech to generated translations, with authored tracks as fallback."""
    original = (metadata.get("language") or "").casefold()
    original_base = original.split("-")[0]
    candidates = []
    for auto, pool in ((False, metadata.get("subtitles") or {}),
                       (True, metadata.get("automatic_captions") or {})):
        for language, formats in pool.items():
            if language != "live_chat" and formats:
                candidates.append((language, auto))

    def priority(candidate):
        language, auto = candidate
        normalized = language.casefold()
        base = normalized.removesuffix("-orig").split("-")[0]
        matches_source = bool(original_base) and base == original_base
        if not auto and matches_source:
            group = 0
        elif auto and normalized.endswith("-orig"):
            group = 1
        elif auto and matches_source:
            group = 2
        elif not auto:
            group = 3
        else:
            group = 4
        preferred = 0 if base == "en" else 1 if base == "sv" else 2
        return group, normalized != original, preferred, normalized

    return sorted(candidates, key=priority)


def retrieve(url: str) -> Transcript:
    import json
    canonical = canonical_url(url)
    # Subtitles do not require a playable video stream. Preserve caption metadata
    # when format discovery fails (e.g. YouTube's JavaScript challenges).
    metadata = json.loads(run_ytdlp(["--skip-download", "--ignore-no-formats-error", "--dump-single-json", canonical]))
    candidates = subtitle_candidates(metadata)
    if not candidates:
        raise UserError("Videon saknar tillgängliga undertexter. Ladda upp SRT/VTT eller klistra in ett tidsatt transkript.")
    failures = []
    # Try distinct existing tracks, not repeated downloads of a rate-limited translation.
    # Bound attempts even when YouTube advertises hundreds of translated languages.
    for language, auto in candidates[:3]:
        try:
            # Isolate partial downloads from failed attempts.
            with tempfile.TemporaryDirectory(prefix="creatoriq-subs-") as directory:
                run_ytdlp(["--skip-download", "--ignore-no-formats-error", "--write-auto-subs" if auto else "--write-subs",
                           "--sub-langs", re.escape(language), "--sub-format", "vtt", "--paths", directory,
                           "-o", "source.%(ext)s", canonical])
                files = list(Path(directory).glob("*.vtt"))
                if not files:
                    raise UserError("Undertexterna kunde inte sparas. Använd manuell inmatning eller SRT/VTT.")
                if files[0].stat().st_size > 6_000_000:
                    raise UserError("Undertextfilen är för stor för V1.")
                transcript = parse_transcript(files[0].read_text(encoding="utf-8"), source="youtube-auto" if auto else "youtube")
            transcript.language = language
            transcript.title = metadata.get("title", "YouTube-video")
            if failures:
                transcript.warnings.append(f"Ett tidigare undertextspår kunde inte hämtas; spåret {language} användes i stället.")
            return transcript
        except UserError as error:
            failures.append(str(error))
    raise UserError(f"Inget av de {len(failures)} provade undertextspåren kunde hämtas. " + failures[-1])
