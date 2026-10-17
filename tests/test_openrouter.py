import json

import httpx
import pytest

from creatoriq.models import UserError
from creatoriq.openrouter import OpenRouter, is_free, parse_json


def entry(identifier="free/model:free", vision=False, **pricing):
    return dict(id=identifier, name=identifier, pricing={"prompt":"0", "completion":"0", **pricing},
                context_length=32000, architecture=dict(input_modalities=["text", "image"] if vision else ["text"], output_modalities=["text"]))


@pytest.mark.parametrize("pricing", [{"prompt":"0.0001"}, {"completion":"1"}, {"image":"0.01"},
                                     {"request":"-1"}, {"prompt":"NaN"}, {"prompt":"Infinity"}, {"image":None}])
def test_any_unknown_or_nonzero_price_is_rejected(pricing):
    assert not is_free(entry(**pricing))


def test_missing_prices_rejected():
    assert not is_free({"pricing": {}})


def test_catalog_filters_and_free_request_guard():
    calls = []
    def handler(request):
        calls.append(request)
        if request.url.path.endswith('/models'):
            return httpx.Response(200, json={"data":[entry(),entry("paid", prompt="0.01"),entry("vision:free",True)]})
        body = json.loads(request.content)
        assert body["provider"]["max_price"] == {"prompt":0,"completion":0}
        assert body["provider"]["allow_fallbacks"] is False
        assert body["model"] == "free/model:free"
        assert request.headers["Authorization"] == "Bearer test-key"
        return httpx.Response(200, json={"choices":[{"message":{"content":'{"clips":[]}'}, "finish_reason":"stop"}]})
    router = OpenRouter(httpx.Client(transport=httpx.MockTransport(handler)))
    assert len(router.models()) == 2
    with pytest.raises(UserError):
        router.choose("paid")
    assert router.choose("vision:free", vision=True)["vision"]
    assert router.complete("test-key", router.choose("free/model:free"), [{"role":"user","content":"Hello"}]) == '{"clips":[]}'
    assert len([r for r in calls if r.method == 'POST']) == 1


def test_price_change_between_catalog_and_completion_blocks_request():
    count = 0
    def handler(request):
        nonlocal count
        assert request.method == "GET", "A paid POST must never be sent"
        count += 1
        return httpx.Response(200, json={"data":[entry(prompt="0" if count == 1 else "0.1")]})
    router = OpenRouter(httpx.Client(transport=httpx.MockTransport(handler)))
    model = router.choose()
    with pytest.raises(UserError):
        router.complete("key", model, [])
    assert count == 2


def test_429_bounded_retry_no_paid_fallback():
    attempts, delays = [], []
    def handler(request):
        if request.method == 'GET':
            return httpx.Response(200, json={"data":[entry()]})
        attempts.append(request)
        return httpx.Response(429, headers={"Retry-After":"999"})
    router = OpenRouter(httpx.Client(transport=httpx.MockTransport(handler)), sleep=delays.append)
    with pytest.raises(UserError, match="gratisgräns"):
        router.complete("key", router.choose(), [])
    assert len(attempts) == 3 and delays == [20,20]


def test_truncated_and_invalid_model_outputs():
    assert parse_json('```json\n{"clips":[]}\n```') == {"clips":[]}
    for invalid in ['prose before {}', '[]', 'not json']:
        with pytest.raises(UserError):
            parse_json(invalid)


def test_non_text_generation_and_router_models_not_offered():
    audio = entry('audio-generator')
    audio['architecture']['output_modalities'] = ['text','audio']
    router_model = entry('router')
    router_model['architecture']['tokenizer'] = 'Router'
    good = entry('text-json')
    good['supported_parameters'] = ['response_format']
    def handler(request):
        if request.method == 'GET':
            return httpx.Response(200,json={'data':[audio,router_model,good]})
        assert json.loads(request.content)['response_format'] == {'type':'json_object'}
        return httpx.Response(200,json={'choices':[{'message':{'content':'{"clips":[]}'}}]})
    router = OpenRouter(httpx.Client(transport=httpx.MockTransport(handler)))
    assert [m['id'] for m in router.models()] == ['text-json']
    router.complete('key',router.choose(),[])


def response(content='{"clips":[]}', reason='stop'):
    return httpx.Response(200, json={'choices':[{'message':{'content':content},'finish_reason':reason}]})


def test_truncated_response_retried_once_with_more_space_same_model_and_zero_price():
    bodies, gets = [], []
    def handler(request):
        if request.method == 'GET':
            gets.append(request)
            return httpx.Response(200,json={'data':[entry()]})
        body=json.loads(request.content)
        bodies.append(body)
        assert body['model']=='free/model:free'
        assert body['provider']['max_price']=={'prompt':0,'completion':0}
        return response('{"clips":[', 'length') if len(bodies)==1 else response()
    router=OpenRouter(httpx.Client(transport=httpx.MockTransport(handler)))
    assert router.complete('key',router.choose(),[{'role':'user','content':'Return JSON.'}],max_tokens=2500)=='{"clips":[]}'
    assert [b['max_tokens'] for b in bodies]==[2500,5000]
    assert len(gets)==3  # Initial discovery plus pricing check before each POST.


def test_incomplete_response_never_accepted_and_length_retry_is_bounded():
    bodies=[]
    def handler(request):
        if request.method=='GET':
            return httpx.Response(200,json={'data':[entry()]})
        bodies.append(json.loads(request.content))
        return response('{"clips":[','length')
    router=OpenRouter(httpx.Client(transport=httpx.MockTransport(handler)))
    with pytest.raises(UserError,match='ofullständigt'):
        router.complete('key',router.choose(),[],max_tokens=3000)
    assert [b['max_tokens'] for b in bodies]==[3000,6000]


def test_advertised_provider_output_cap_respected_without_useless_length_retry():
    bodies=[]
    model=entry()
    model['top_provider']={'max_completion_tokens':2000}
    def handler(request):
        if request.method=='GET':
            return httpx.Response(200,json={'data':[model]})
        bodies.append(json.loads(request.content))
        return response('{','length')
    router=OpenRouter(httpx.Client(transport=httpx.MockTransport(handler)))
    with pytest.raises(UserError,match='modellens gränser'):
        router.complete('key',router.choose(),[],max_tokens=7000)
    assert [b['max_tokens'] for b in bodies]==[2000]


def test_complete_json_at_length_boundary_is_usable_without_repeat():
    posts=[]
    def handler(request):
        if request.method=='GET':
            return httpx.Response(200,json={'data':[entry()]})
        posts.append(request)
        return response('{"clips":[]}','length')
    router=OpenRouter(httpx.Client(transport=httpx.MockTransport(handler)))
    assert router.complete('key',router.choose(),[])=='{"clips":[]}'
    assert len(posts)==1


def test_price_becoming_paid_before_length_retry_blocks_second_post():
    gets,posts=[],[]
    def handler(request):
        if request.method=='GET':
            gets.append(request)
            return httpx.Response(200,json={'data':[entry(prompt='1' if len(gets)>2 else '0')]})
        posts.append(request)
        return response('{','length')
    router=OpenRouter(httpx.Client(transport=httpx.MockTransport(handler)))
    with pytest.raises(UserError,match='Ingen kompatibel gratis'):
        router.complete('key',router.choose(),[])
    assert len(posts)==1 and len(gets)==3


def test_context_room_and_reasoning_preferences_are_respected():
    bodies=[]
    model=entry()
    model['context_length']=8192
    model['supported_parameters']=['reasoning','response_format']
    model['top_provider']={'context_length':8192,'max_completion_tokens':12000}
    def handler(request):
        if request.method=='GET':
            return httpx.Response(200,json={'data':[model]})
        bodies.append(json.loads(request.content))
        return response()
    router=OpenRouter(httpx.Client(transport=httpx.MockTransport(handler)))
    router.complete('key',router.choose(),[{'role':'user','content':'x'*7000}],max_tokens=8000)
    assert bodies[0]['max_tokens']==8192-7000-256-32
    assert bodies[0]['reasoning']=={'effort':'low','exclude':True}
    assert bodies[0]['response_format']=={'type':'json_object'}


@pytest.mark.parametrize(('payload','expected'), [
    ({'choices':[{'message':{'content':None}}]}, 'ingen användbar svarstext'),
    ({'choices':[{'message':{'content':'  '}}]}, 'ingen användbar svarstext'),
    ({'choices':[{'message':{'refusal':'provider-private-detail'}}]}, 'avböjde'),
    ({'error':{'code':500,'message':'provider-private-detail'}}, 'leverantörsfel'),
    ({'error':{'code':429,'message':'provider-private-detail'}}, 'gratisgräns'),
    ({'choices':[]}, 'oväntat format'),
])
def test_provider_failures_are_distinct_and_never_expose_raw_details(payload,expected):
    def handler(request):
        return httpx.Response(200,json={'data':[entry()]} if request.method=='GET' else payload)
    router=OpenRouter(httpx.Client(transport=httpx.MockTransport(handler)))
    with pytest.raises(UserError,match=expected) as error:
        router.complete('key',router.choose(),[])
    assert 'provider-private-detail' not in str(error.value)


def test_catalog_distinguishes_image_models_and_audio_only_multimodal_models():
    audio=entry('audio:free')
    audio['architecture']['input_modalities']=['text','audio']
    models=[entry('text:free'),entry('vision:free',True),audio]
    router=OpenRouter(httpx.Client(transport=httpx.MockTransport(lambda _:httpx.Response(200,json={'data':models}))))
    catalog={m['id']:m for m in router.models()}
    assert catalog['text:free']['multimodal'] is False
    assert catalog['vision:free']['multimodal'] is True and catalog['vision:free']['vision'] is True
    assert catalog['audio:free']['multimodal'] is True and catalog['audio:free']['vision'] is False
    assert catalog['audio:free']['input_modalities']==['text','audio']
    with pytest.raises(UserError):
        router.choose('audio:free',vision=True)
