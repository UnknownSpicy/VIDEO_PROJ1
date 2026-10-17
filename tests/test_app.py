import json
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from creatoriq.app import create_app
from creatoriq.credentials import Credentials
from creatoriq.models import AnalysisRequest, UserError
from creatoriq.openrouter import OpenRouter
from creatoriq.storage import Store

from .test_openrouter import entry
import httpx

FIXTURE = Path(__file__).parent / 'fixtures' / 'example.vtt'


class FakeCredentials:
    secure_backend = False
    def __init__(self):
        self.value = None
    def get(self):
        return self.value
    def set(self, key, persist):
        if persist:
            raise UserError('Ingen säker nyckelhanterare')
        self.value = key
    def clear(self):
        self.value = None
        return {"configured":False}


def model_handler(request):
    if request.method == 'GET':
        return httpx.Response(200, json={"data":[entry()]})
    body = json.loads(request.content)
    payload = json.loads(body['messages'][-1]['content'])
    if 'transcript' in payload:
        ids = [c['id'] for c in payload['transcript']]
        answer = {"clips":[dict(start_cue_id=ids[0], end_cue_id=ids[min(4,len(ids)-1)], topic='Insikt', description='Bli användbar.',
                                hook='Frågan som förändrade allt', reason='Ett konkret exempel.', engagement=88, engagement_reason='Tydlig poäng.')]}
    else:
        answer = {"ranked_ids":[c['id'] for c in payload['candidates']]}
    return httpx.Response(200, json={"choices":[{"message":{"content":json.dumps(answer)}, "finish_reason":"stop"}]})


@pytest.fixture
def client(tmp_path):
    app = create_app(tmp_path, router=OpenRouter(httpx.Client(transport=httpx.MockTransport(model_handler))), credentials=FakeCredentials())
    with TestClient(app) as client:
        token = client.get('/api/status').json()['csrf_token']
        client.headers['X-CreatorIQ-Token'] = token
        yield client


def configure(client):
    response = client.post('/api/key', json={"key":"secret-test-key","persist":False})
    assert response.status_code == 200
    assert 'secret-test-key' not in response.text


def submit_and_wait(client, mode='transcript', use_file=True, max_clips=6):
    data = dict(instructions='Hitta konkreta insikter.', mode=mode, max_clips=max_clips)
    if mode != 'transcript':
        data['youtube_url'] = 'https://www.youtube.com/watch?v=abcdefghijk'
    kwargs = {"files":{"file":('captions.vtt',FIXTURE.read_bytes(),'text/vtt')}} if use_file else {"data":{**data, 'transcript_text':FIXTURE.read_text()}}
    if use_file:
        kwargs['data'] = data
    response = client.post('/api/analyses', **kwargs)
    assert response.status_code == 202, response.text
    identifier = response.json()['id']
    for _ in range(100):
        result = client.get('/api/analyses/' + identifier).json()
        if result['status'] in ('done','error'):
            return result
        time.sleep(.01)
    pytest.fail('Worker did not finish')


def test_upload_analyze_review_adjust_export_and_persist(client):
    configure(client)
    result = submit_and_wait(client)
    assert result['status'] == 'done', result
    clip = result['results'][0]['clips'][0]
    assert (clip['start'], clip['end']) == (0,50)
    assert 'secret-test-key' not in json.dumps(result)
    path = f"/api/analyses/{result['id']}/clips/transcript/{clip['id']}"
    changed = client.patch(path, json={"start_cue_id":"c00001","end_cue_id":"c00003","status":"selected"})
    assert changed.status_code == 200
    clip = changed.json()['results'][0]['clips'][0]
    assert (clip['start'],clip['end'],clip['duration']) == (8,40,32)
    assert clip['opening_dialogue'] == result['transcript']['cues'][1]['text']
    assert clip['status'] == 'selected' and clip['adjusted']
    exported = client.get(f"/api/analyses/{result['id']}/export?selected_only=true")
    assert exported.status_code == 200
    assert exported.json()['schema_version'] == 1
    assert len(exported.json()['results'][0]['clips']) == 1
    assert client.patch(path,json={"status":"rejected"}).status_code == 200
    assert client.get(f"/api/analyses/{result['id']}/export?selected_only=true").json()['results'][0]['clips'] == []
    assert client.patch(path,json={"start_cue_id":"fake"}).status_code == 400
    assert client.patch(path,json={"start_cue_id":"c00004","end_cue_id":"c00000"}).status_code == 400
    assert client.get('/api/analyses').json()['analyses'][0]['id'] == result['id']


def test_paste_and_unavailable_vision_preserve_baseline(client):
    configure(client)
    result = submit_and_wait(client,mode='compare',use_file=False)
    assert result['status'] == 'done'
    assert len(result['results']) == 1 and result['results'][0]['mode'] == 'transcript'
    assert any('Bildruteanalysen kunde inte slutföras' in w for w in result['warnings'])


def test_missing_key_and_local_api_protection(client):
    assert client.post('/api/analyses',data={"instructions":"Find clips"}).status_code == 400
    assert client.post('/api/key',json={"key":"never-echo-this"},headers={"X-CreatorIQ-Token":"wrong"}).status_code == 403
    invalid = client.post('/api/key',json={"key":{"secret":"never-echo-this"}})
    assert invalid.status_code == 422 and 'never-echo-this' not in invalid.text
    assert client.get('/',headers={"Host":"evil.example"}).status_code == 400
    assert "frame-ancestors 'none'" in client.get('/').headers['content-security-policy']


def test_invalid_upload_and_url(client):
    configure(client)
    assert client.post('/api/analyses',data={"instructions":"hello"},files={"file":('evil.html',b'<html>')}).status_code == 400
    assert client.post('/api/analyses',data={"instructions":"hello","youtube_url":"https://evil.example"}).status_code == 400
    result = submit_and_wait(client)
    assert result['status'] == 'done'


def test_restart_marks_incomplete_and_retains_results(tmp_path):
    path = tmp_path / 'results.sqlite3'
    store = Store(path)
    finished = store.create({"mode":"transcript"})
    store.update(finished['id'],status='done',results=[{"clips":[]}])
    interrupted = store.create({"mode":"transcript"})
    reopened = Store(path)
    assert reopened.get(finished['id'])['status'] == 'done'
    assert reopened.get(interrupted['id'])['status'] == 'error'


def test_no_plaintext_keyring_and_session_key(monkeypatch):
    class Plaintext:
        priority = 1
    monkeypatch.delenv('OPENROUTER_API_KEY',raising=False)
    monkeypatch.setattr('keyring.get_keyring',lambda:Plaintext())
    credentials = Credentials()
    assert not credentials.secure_backend
    with pytest.raises(UserError):
        credentials.set('key',True)
    credentials.set('only-in-memory',False)
    assert credentials.get() == 'only-in-memory'
    assert not credentials.clear()['configured']


def test_reported_transcript_completes_analysis_and_exports_untimed_context(client):
    configure(client)
    text = (FIXTURE.parent / 'equal_timestamps.txt').read_text()
    response = client.post('/api/analyses',data={'instructions':'Hitta roliga självbärande ögonblick.','transcript_text':text})
    assert response.status_code == 202
    identifier = response.json()['id']
    for _ in range(100):
        result = client.get('/api/analyses/'+identifier).json()
        if result['status'] in ('done','error'):
            break
        time.sleep(.01)
    assert result['status'] == 'done',result
    assert any('samma tidsstämpel' in w for w in result['warnings'])
    assert result['transcript']['untimed_tail']['start'] == 319
    exported = client.get(f'/api/analyses/{identifier}/export').json()
    assert exported['transcript']['untimed_tail']['text'].startswith('The final line still needs')


def test_server_start_refreshes_an_existing_cached_catalog(tmp_path):
    import threading
    catalog=[entry('old:free')]
    refreshed=threading.Event()
    def handler(request):
        if catalog[0]['id']=='new:free':
            refreshed.set()
        return httpx.Response(200,json={'data':catalog})
    router=OpenRouter(httpx.Client(transport=httpx.MockTransport(handler)))
    assert router.models()[0]['id']=='old:free'
    catalog[:]=[entry('new:free',True)]
    app=create_app(tmp_path,router=router,credentials=FakeCredentials())
    with TestClient(app) as client:
        assert refreshed.wait(2),'Startup must force a fresh catalog request'
        result=client.get('/api/models').json()['models']
        assert result[0]['id']=='new:free'
        assert result[0]['multimodal'] is True


def test_catalog_failure_at_start_does_not_prevent_opening_settings_or_history(tmp_path):
    def handler(request):
        return httpx.Response(503,json={'error':'unavailable'})
    app=create_app(tmp_path,router=OpenRouter(httpx.Client(transport=httpx.MockTransport(handler))),credentials=FakeCredentials())
    with TestClient(app) as client:
        assert client.get('/').status_code==200
        assert client.get('/api/status').status_code==200
        assert client.get('/api/analyses').status_code==200
        response=client.get('/api/models?refresh=true')
        assert response.status_code==400
        assert 'modellista kunde inte hämtas' in response.json()['detail']


def test_requested_clip_count_reaches_the_first_model_request(tmp_path):
    bodies=[]
    def handler(request):
        if request.method=='POST':
            bodies.append(json.loads(request.content))
        return model_handler(request)
    app=create_app(tmp_path,router=OpenRouter(httpx.Client(transport=httpx.MockTransport(handler))),credentials=FakeCredentials())
    with TestClient(app) as client:
        client.headers['X-CreatorIQ-Token']=client.get('/api/status').json()['csrf_token']
        configure(client)
        result=submit_and_wait(client,max_clips=3)
        assert result['status']=='done',result
        payload=json.loads(bodies[0]['messages'][-1]['content'])
        assert payload['max_clips']==3
        assert 'Select at most 3 clips.' in bodies[0]['messages'][0]['content']
        assert bodies[0]['max_tokens']==3300
        assert result['model_id']==result['results'][0]['model']
