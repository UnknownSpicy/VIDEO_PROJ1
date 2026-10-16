import base64
import json
import shutil
import subprocess
from pathlib import Path

import httpx
import pytest

from creatoriq.analysis import Candidate, TranscriptAnalyzer, resolve
from creatoriq.app import create_app
from creatoriq.models import UserError
from creatoriq.openrouter import OpenRouter
from creatoriq.transcripts import parse_transcript
from creatoriq.vision import FrameSampler, SampledFrameAnalyzer
from fastapi.testclient import TestClient

from .test_app import FakeCredentials, configure, submit_and_wait
from .test_openrouter import entry

FIXTURE = Path(__file__).parent / 'fixtures' / 'example.vtt'


def candidate(transcript):
    return resolve(Candidate(start_cue_id='c00000',end_cue_id='c00004', topic='Publik',
                             description='Ett lärorikt exempel.', hook='Var användbar', reason='Relevant.',
                             engagement=80,engagement_reason='Tydlig insikt.'),transcript)


@pytest.mark.skipif(not shutil.which('ffmpeg'),reason='FFmpeg is optional')
def test_real_ffmpeg_frame_extraction_from_fixture_video(tmp_path,monkeypatch):
    calls = []
    def fake_download(args,timeout=120):
        calls.append(args)
        target = args[args.index('--output')+1].replace('%(ext)s','mp4')
        subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-f','lavfi','-i',
                        'color=c=green:s=320x180:d=1.5','-c:v','mpeg4',target],check=True,capture_output=True)
    monkeypatch.setattr('creatoriq.vision.run_ytdlp',fake_download)
    transcript = parse_transcript(FIXTURE.read_text())
    frames = FrameSampler().sample('https://youtu.be/abcdefghijk',[candidate(transcript)])
    assert len(frames) == 2
    assert [f['requested_time'] for f in frames] == [2,25]
    assert all(base64.b64decode(f['data']).startswith(b'\xff\xd8') for f in frames)
    assert all('--download-sections' in args for args in calls)
    assert all('--max-filesize' in args for args in calls)


class FixtureSampler:
    def sample(self,url,candidates):
        return [dict(clip_id=c.id,requested_time=c.start+1,timing_note='Fixture frame',data=base64.b64encode(b'fixture-image').decode()) for c in candidates[:6]]


def multimodal_handler(request):
    if request.method == 'GET':
        return httpx.Response(200,json={"data":[entry(),entry('vision:free',True)]})
    body = json.loads(request.content)
    content = body['messages'][-1]['content']
    if isinstance(content,list):
        assert body['model'] == 'vision:free'
        assert any(c['type'] == 'image_url' for c in content)
        answer = {"observation":"En person står vid en tavla i denna samplade stillbild. Rörelse kan inte bedömas."}
    else:
        payload = json.loads(content)
        if 'transcript' in payload:
            ids = [c['id'] for c in payload['transcript']]
            answer = {"clips":[dict(start_cue_id=ids[0],end_cue_id=ids[4],topic='Insikt',description='Konkret',hook='En poäng',reason='Relevant',engagement=85,engagement_reason='Tydligt') ]}
        else:
            assert any(c.get('visual') for c in payload['candidates'])
            answer = {"ranked_ids":[c['id'] for c in reversed(payload['candidates'])]}
    return httpx.Response(200,json={"choices":[{"message":{"content":json.dumps(answer)},"finish_reason":"stop"}]})


def test_compare_saves_both_modes_and_visual_provenance(tmp_path):
    router = OpenRouter(httpx.Client(transport=httpx.MockTransport(multimodal_handler)))
    vision = SampledFrameAnalyzer(router,FixtureSampler())
    app = create_app(tmp_path,router=router,credentials=FakeCredentials(),vision=vision)
    with TestClient(app) as client:
        client.headers['X-CreatorIQ-Token'] = client.get('/api/status').json()['csrf_token']
        configure(client)
        result = submit_and_wait(client,'compare')
        assert result['status'] == 'done',result
        assert [r['mode'] for r in result['results']] == ['transcript','multimodal']
        baseline, enhanced = result['results']
        assert baseline['clips'][0]['visual_context'] is None
        assert enhanced['clips'][0]['visual_context']
        assert 'data' not in enhanced['frames'][0]  # No base64 blobs in SQLite/export.
        assert 'Ingen kontinuerlig' in enhanced['method']
        clip = enhanced['clips'][0]
        changed = client.patch(f"/api/analyses/{result['id']}/clips/multimodal/{clip['id']}",json={"end_cue_id":"c00003"})
        updated = changed.json()['results'][1]['clips'][0]
        assert updated['visual_context'] is None
        assert 'inte analyserats på nytt' in updated['boundary_warning']


def test_unavailable_ffmpeg_has_actionable_error(monkeypatch):
    monkeypatch.setattr('creatoriq.vision.shutil.which',lambda _:None)
    with pytest.raises(UserError,match='FFmpeg'):
        FrameSampler().sample('https://youtu.be/abcdefghijk',[])
