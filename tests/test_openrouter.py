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
