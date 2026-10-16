import json
from pathlib import Path

import pytest

from creatoriq.models import UserError
from creatoriq.transcripts import retrieve, run_ytdlp, youtube_error

FIXTURE = Path(__file__).parent / 'fixtures' / 'example.vtt'


@pytest.mark.parametrize('automatic',[False,True])
def test_ytdlp_metadata_subtitle_selection_and_vtt_pipeline(monkeypatch,automatic):
    calls=[]
    def fake_ytdlp(args,timeout=120):
        calls.append(args)
        if '--dump-single-json' in args:
            return json.dumps({'title':'A real title','subtitles':{} if automatic else {'sv':[{'ext':'vtt'}]},
                               'automatic_captions':{'en':[{'ext':'vtt'}]}})
        directory = Path(args[args.index('--paths')+1])
        (directory/'source.vtt').write_bytes(FIXTURE.read_bytes())
        return ''
    monkeypatch.setattr('creatoriq.transcripts.run_ytdlp',fake_ytdlp)
    transcript = retrieve('https://youtu.be/abcdefghijk')
    assert transcript.title == 'A real title'
    assert transcript.language == ('en' if automatic else 'sv')
    assert transcript.source == ('youtube-auto' if automatic else 'youtube')
    assert len(transcript.cues) == 11
    assert ('--write-auto-subs' if automatic else '--write-subs') in calls[1]
    assert all('--ignore-no-formats-error' in args for args in calls)
    assert calls[0][-1] == 'https://www.youtube.com/watch?v=abcdefghijk'


def test_missing_subtitles_offers_manual_fallback(monkeypatch):
    monkeypatch.setattr('creatoriq.transcripts.run_ytdlp',lambda *args,**kwargs:json.dumps({'title':'No subs'}))
    with pytest.raises(UserError,match='SRT/VTT'):
        retrieve('https://youtu.be/abcdefghijk')


@pytest.mark.parametrize(('stderr', 'expected'), [
    ('No module named yt_dlp', 'yt-dlp saknas'),
    ('Unable to connect to proxy: Tunnel connection failed: 403 Forbidden', 'proxy'),
    ('CERTIFICATE_VERIFY_FAILED', 'TLS-certifikat'),
    ("Sign in to confirm you’re not a bot", 'botkontroll'),
    ('Private video', 'privat'),
    ('This is a members-only video', 'medlemskap'),
    ('Sign in to confirm your age', 'åldersverifiering'),
    ('Video not available in your country', 'region'),
    ('HTTP Error 429: Too Many Requests', 'begränsar'),
    ('HTTP Error 403: Forbidden', 'HTTP 403'),
    ('No supported JavaScript runtime could be found', 'Node.js'),
    ('n challenge solving failed', 'JavaScript'),
    ('Requested format is not available', 'videoformat'),
    ('Video unavailable', 'otillgänglig'),
    ('getaddrinfo failed', 'Nätverksanslutningen'),
    ('An unknown provider error', 'README'),
])
def test_failure_is_actionable_and_never_exposes_raw_diagnostics(stderr, expected):
    secret = 'https://source.invalid/?token=never-expose-this'
    message = youtube_error(stderr + '\n' + secret + '\nC:\\Users\\Personal\\cookies.txt')
    assert expected in message
    assert 'never-expose-this' not in message
    assert 'Personal' not in message


def test_subprocess_failure_is_classified_without_disabling_tls(monkeypatch):
    from subprocess import CompletedProcess
    commands = []
    def fake_run(command, **kwargs):
        commands.append(command)
        return CompletedProcess(command, 1, stdout='', stderr='HTTP Error 429: Too Many Requests')
    monkeypatch.setattr('creatoriq.transcripts.subprocess.run', fake_run)
    monkeypatch.setattr('creatoriq.transcripts.shutil.which', lambda _: '/node')
    with pytest.raises(UserError, match='begränsar'):
        run_ytdlp(['--skip-download', 'https://www.youtube.com/watch?v=OOhdx1TLutw'])
    assert '--js-runtimes' in commands[0]
    assert '--no-check-certificates' not in commands[0]


def test_subprocess_timeout_and_unavailable_executable(monkeypatch):
    import subprocess
    def timeout(*args, **kwargs):
        raise subprocess.TimeoutExpired('yt-dlp', 120)
    monkeypatch.setattr('creatoriq.transcripts.subprocess.run', timeout)
    with pytest.raises(UserError, match='för lång tid'):
        run_ytdlp([])
    def unavailable(*args, **kwargs):
        raise OSError('private path must not leak')
    monkeypatch.setattr('creatoriq.transcripts.subprocess.run', unavailable)
    with pytest.raises(UserError, match='kunde inte startas'):
        run_ytdlp([])
