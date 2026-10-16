import json
import threading
import time
from decimal import Decimal, InvalidOperation

import httpx

from .models import UserError

BASE = "https://openrouter.ai/api/v1"


def is_free(model: dict):
    pricing = model.get("pricing") or {}
    if not isinstance(pricing, dict):
        return False
    if "prompt" not in pricing or "completion" not in pricing:
        return False
    try:
        # Reject every advertised nonzero charge, including image/request costs.
        return all(Decimal(str(value)).is_finite() and Decimal(str(value)) == 0 for value in pricing.values())
    except (InvalidOperation, TypeError, ValueError):
        return False


class OpenRouter:
    def __init__(self, client=None, sleep=time.sleep):
        self.client = client or httpx.Client(timeout=httpx.Timeout(100, connect=15), follow_redirects=False)
        self.sleep = sleep
        self._models = []
        self._expires = 0
        self._lock = threading.Lock()

    def models(self, refresh=False):
        with self._lock:
            if self._models and time.monotonic() < self._expires and not refresh:
                return list(self._models)
            try:
                response = self.client.get(BASE + "/models")
                response.raise_for_status()
                payload = response.json()
                if not isinstance(payload.get("data"), list):
                    raise ValueError()
            except (httpx.HTTPError, ValueError, TypeError):
                raise UserError("OpenRouters modellista kunde inte hämtas. Kontrollera anslutningen och försök igen. Ingen betalmodell används.") from None
            models = []
            for model in payload["data"]:
                if not isinstance(model, dict) or not isinstance(model.get("id"), str):
                    continue
                architecture = model.get("architecture") or {}
                inputs = architecture.get("input_modalities", [])
                outputs = architecture.get("output_modalities", [])
                try:
                    context = int(model.get("context_length") or 0)
                except (TypeError, ValueError):
                    continue
                if (is_free(model) and "text" in inputs and outputs == ["text"]
                        and architecture.get("tokenizer") != "Router" and context >= 8192):
                    models.append(dict(id=model["id"], name=model.get("name", model["id"]),
                                       context_length=context, vision="image" in inputs,
                                       json_output="response_format" in model.get("supported_parameters", [])))
            self._models = sorted(models, key=lambda m: (not m["json_output"], "preview" in m["id"], -min(m["context_length"], 262144), m["id"]))
            self._expires = time.monotonic() + 300
            return list(self._models)

    def choose(self, requested=None, vision=False, refresh=False):
        models = [m for m in self.models(refresh) if not vision or m["vision"]]
        if requested:
            models = [m for m in models if m["id"] == requested]
        if not models:
            kind = "bildförstående " if vision else ""
            raise UserError(f"Ingen kompatibel gratis {kind}modell är tillgänglig för valet. Uppdatera modellistan eller välj transkriptanalys. Ingen betalmodell används.")
        if not requested and not vision:
            # Prefer a text-only JSON-capable model for the baseline when available.
            models.sort(key=lambda m: (not m["json_output"], m["vision"]))
        return models[0]

    def complete(self, key: str, model: dict, messages: list, max_tokens=3500):
        # Refresh pricing before EVERY paid-boundary request. Fail closed on stale/unavailable catalog.
        current = self.choose(model["id"], refresh=True)
        if any(isinstance(m.get("content"), list) for m in messages) and not current["vision"]:
            raise UserError("Den valda gratismodellen stöder inte bilder.")
        body = dict(model=current["id"], messages=messages, temperature=0.2, max_tokens=max_tokens,
                    provider={"allow_fallbacks": False, "max_price": {"prompt": 0, "completion": 0}},
                    plugins=[])
        if current["json_output"]:
            body["response_format"] = {"type": "json_object"}
        for attempt in range(3):
            try:
                response = self.client.post(BASE + "/chat/completions", json=body,
                                            headers={"Authorization": f"Bearer {key}", "X-Title": "CreatorIQ"})
            except httpx.HTTPError:
                raise UserError("Anslutningen till OpenRouter avbröts. Starta analysen igen när anslutningen fungerar.") from None
            if response.status_code in (429, 502, 503, 504) and attempt < 2:
                try:
                    delay = min(20, max(1, float(response.headers.get("retry-after", 2 ** (attempt + 1)))))
                except ValueError:
                    delay = 2 ** (attempt + 1)
                self.sleep(delay)
                continue
            if response.status_code in (401, 403):
                raise UserError("OpenRouter nekade åtkomst. Kontrollera API-nyckeln och kontots behörighet för gratismodeller.")
            if response.status_code == 429:
                raise UserError("OpenRouters gratisgräns är nådd. Vänta och försök igen. Ingen betalmodell används.")
            if response.status_code >= 400:
                raise UserError(f"Gratismodellen kunde inte slutföra anropet (HTTP {response.status_code}). Välj en annan gratis modell och försök igen.")
            try:
                data = response.json()
                if data.get("error"):
                    raise ValueError()
                choice = data["choices"][0]
                if choice.get("finish_reason") == "length":
                    raise UserError("Modellens svar blev för långt. Välj färre klipp eller en annan gratis modell.")
                content = choice["message"]["content"]
                if not isinstance(content, str):
                    raise ValueError()
                return content
            except (ValueError, KeyError, IndexError, TypeError):
                raise UserError("OpenRouter returnerade inget användbart svar. Välj en annan gratis modell.") from None
        raise UserError("OpenRouter är tillfälligt otillgängligt.")


def parse_json(content: str):
    value = content.strip()
    if value.startswith("```"):
        lines = value.splitlines()
        value = "\n".join(lines[1:-1]) if lines[-1].strip() == "```" else value
    try:
        result = json.loads(value)
    except (ValueError, TypeError):
        raise UserError("AI-modellen returnerade ogiltig JSON. Välj en annan gratis modell och försök igen.") from None
    if not isinstance(result, dict):
        raise UserError("AI-modellens svar hade fel format.")
    return result
