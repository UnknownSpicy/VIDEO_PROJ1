"""Explicit offline fixture server for browser verification. NEVER used by the product entry point.

CREATORIQ_DATA_DIR must point to a disposable directory. Run from the repository:
  python -m tests.serve_fixture
Model calls and video sampling are replaced by fixtures. No network calls or real keys.
"""
import os
from pathlib import Path

import httpx
import uvicorn

from creatoriq.app import create_app
from creatoriq.openrouter import OpenRouter
from creatoriq.vision import SampledFrameAnalyzer
from .test_app import FakeCredentials
from .test_vision import FixtureSampler, multimodal_handler


def fixture_app():
    directory = os.environ.get('CREATORIQ_DATA_DIR')
    if not directory:
        raise RuntimeError('Set CREATORIQ_DATA_DIR to a disposable fixture directory.')
    router = OpenRouter(httpx.Client(transport=httpx.MockTransport(multimodal_handler)))
    return create_app(Path(directory), router=router, credentials=FakeCredentials(),
                      vision=SampledFrameAnalyzer(router,FixtureSampler()))


if __name__ == '__main__':
    uvicorn.run('tests.serve_fixture:fixture_app',factory=True,host='127.0.0.1',port=8001)
