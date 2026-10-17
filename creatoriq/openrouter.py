import json
import threading
import time
from decimal import Decimal, InvalidOperation

import httpx

from .models import UserError

BASE = "https://openrouter.ai/api/v1"
MAX_OUTPUT_TOKENS = 16_384


def completion_budget(model: dict, messages: list, requested: int) -> int:
    """Conservative text estimate; image allowance avoids counting base64 as text tokens."""
    input_size = 256
    for message in messages:
        input_size += 32
        content = message.get("content", "")
        if isinstance(content, str):
            input_size += len(content)
        elif isinstance(content, list):
            for part in content:
                if part.get("type") == "text":
                    input_size += len(part.get("text", ""))
                elif part.get("type") == "image_url":
                    input_size += 4096
    remaining = model["context_length"] - input_size
    budget = min(requested, MAX_OUTPUT_TOKENS, model.get("max_completion_tokens") or MAX_OUTPUT_TOKENS, remaining)
    if budget < 256:
        raise UserError("Modellens kontextfönster lämnar för lite plats för ett svar. Välj en större gratis modell eller korta instruktionerna.")
    return budget


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
                response = self.client.get(BASE + "/models", timeout=20)
                response.raise_for_status()
                payload = response.json()
                if not isinstance(payload, dict) or not isinstance(payload.get("data"), list):
                    raise ValueError()
            except (httpx.HTTPError, ValueError, TypeError):
                raise UserError("OpenRouters modellista kunde inte hämtas. Kontrollera anslutningen och försök igen. Ingen betalmodell används.") from None
            models = []
            for model in payload["data"]:
                if not isinstance(model, dict) or not isinstance(model.get("id"), str):
                    continue
                architecture = model.get("architecture") or {}
                if not isinstance(architecture, dict):
                    continue
                inputs = architecture.get("input_modalities", [])
                outputs = architecture.get("output_modalities", [])
                if not isinstance(inputs, list) or not all(isinstance(value, str) for value in inputs):
                    continue
                provider = model.get("top_provider") or {}
                if not isinstance(provider, dict):
                    continue
                try:
                    context = int(model.get("context_length") or 0)
                    provider_context = provider.get("context_length")
                    if provider_context:
                        context = min(context, int(provider_context))
                    output_limit = provider.get("max_completion_tokens")
                    output_limit = int(output_limit) if output_limit is not None else None
                except (TypeError, ValueError):
                    continue
                parameters = model.get("supported_parameters") or []
                if (is_free(model) and "text" in inputs and outputs == ["text"]
                        and architecture.get("tokenizer") != "Router" and context >= 8192
                        and (output_limit is None or output_limit > 0)):
                    models.append(dict(id=model["id"], name=model.get("name", model["id"]),
                                       context_length=context, vision="image" in inputs,
                                       input_modalities=inputs,
                                       multimodal=any(value in inputs for value in ("image", "audio", "video")),
                                       max_completion_tokens=output_limit,
                                       reasoning="reasoning" in parameters or "reasoning_effort" in parameters,
                                       json_output="response_format" in parameters))
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
        target = max_tokens
        length_retry = False
        transient_attempts = 0
        while True:
            current = self.choose(model["id"], refresh=True)
            if any(isinstance(m.get("content"), list) for m in messages) and not current["vision"]:
                raise UserError("Den valda gratismodellen stöder inte bilder.")
            budget = completion_budget(current, messages, target)
            body = dict(model=current["id"], messages=messages, temperature=0.2, max_tokens=budget,
                        provider={"allow_fallbacks": False, "max_price": {"prompt": 0, "completion": 0}},
                        plugins=[])
            if current["json_output"]:
                body["response_format"] = {"type": "json_object"}
            if current["reasoning"]:
                body["reasoning"] = {"effort": "low", "exclude": True}
            try:
                response = self.client.post(BASE + "/chat/completions", json=body,
                                            headers={"Authorization": f"Bearer {key}", "X-Title": "CreatorIQ"})
            except httpx.HTTPError:
                raise UserError("Anslutningen till OpenRouter avbröts. Starta analysen igen när anslutningen fungerar.") from None
            if response.status_code in (429, 502, 503, 504) and transient_attempts < 2:
                try:
                    delay = min(20, max(1, float(response.headers.get("retry-after", 2 ** (transient_attempts + 1)))))
                except ValueError:
                    delay = 2 ** (transient_attempts + 1)
                transient_attempts += 1
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
                    # Only expose a numeric provider code, never raw upstream error strings.
                    error = data["error"]
                    code = error.get("code") if isinstance(error, dict) else None
                    if code == 429:
                        raise UserError("OpenRouters gratisgräns är nådd. Vänta innan du försöker igen.")
                    raise UserError("OpenRouter rapporterade ett modell-/leverantörsfel. Ingen användbar AI-text kunde hämtas. Uppdatera modellistan och kontrollera ditt modellval.")
                choice = data["choices"][0]
                message = choice["message"]
                content = message.get("content")
                if message.get("refusal") or choice.get("finish_reason") == "content_filter":
                    raise UserError("Modellen avböjde analysen eller filtrerade svaret. Kontrollera innehållet och modellens användningsvillkor.")
                if choice.get("finish_reason") == "length":
                    # Some providers label a complete JSON object 'length'; validate before discarding it.
                    if isinstance(content, str):
                        try:
                            parse_json(content)
                            return content
                        except UserError:
                            pass
                    larger = completion_budget(current, messages, budget * 2)
                    if not length_retry and larger > budget:
                        length_retry = True
                        target = larger
                        continue
                    raise UserError("Modellens svar nådde längdgränsen och blev ofullständigt. Appen kunde inte ge mer svarsutrymme inom modellens gränser, eller det större försöket räckte inte. Välj färre klipp eller en annan gratis modell; transkriptet har lästs in.")
                if not isinstance(content, str) or not content.strip():
                    raise UserError("Modellen returnerade ingen användbar svarstext. Det inlästa transkriptet är tillgängligt; kontrollera modellvalet och försök igen.")
                return content
            except (ValueError, KeyError, IndexError, TypeError, AttributeError):
                raise UserError("OpenRouters svar hade ett oväntat format. Det inlästa transkriptet är tillgängligt; kontrollera modellvalet och försök igen.") from None


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
