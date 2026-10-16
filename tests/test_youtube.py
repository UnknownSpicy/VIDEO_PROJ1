import json
from pathlib import Path

import pytest

from creatoriq.models import UserError
from creatoriq.transcripts import retrieve

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
    assert calls[0][-1] == 'https://www.youtube.com/watch?v=abcdefghijk'


def test_missing_subtitles_offers_manual_fallback(monkeypatch):
    monkeypatch.setattr('creatoriq.transcripts.run_ytdlp',lambda *args,**kwargs:json.dumps({'title':'No subs'}))
    with pytest.raises(UserError,match='SRT/VTT'):
        retrieve('https://youtu.be/abcdefghijk')
