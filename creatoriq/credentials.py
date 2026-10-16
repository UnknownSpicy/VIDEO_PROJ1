import os
import threading

import keyring

from .models import UserError


class Credentials:
    """Never writes raw keys to project files, SQLite, API responses or logs."""
    def __init__(self):
        self._session = None
        self._lock = threading.Lock()
        self.secure_backend = False
        try:
            backend = keyring.get_keyring()
            module = type(backend).__module__
            # Explicit OS implementations only. Exclude plaintext/chainer backends.
            self.secure_backend = module in {
                "keyring.backends.Windows", "keyring.backends.macOS", "keyring.backends.SecretService"
            } and backend.priority > 0
        except Exception:
            pass

    def get(self):
        with self._lock:
            if self._session:
                return self._session
            if os.environ.get("OPENROUTER_API_KEY"):
                return os.environ["OPENROUTER_API_KEY"]
            if self.secure_backend:
                try:
                    return keyring.get_password("CreatorIQ", "openrouter")
                except Exception:
                    return None
        return None

    def set(self, value: str, persist: bool):
        value = value.strip()
        if not value or len(value) > 1000 or any(c.isspace() for c in value):
            raise UserError("Ange en giltig OpenRouter-nyckel utan blanksteg.")
        with self._lock:
            if persist:
                if not self.secure_backend:
                    raise UserError("Ingen säker systemnyckelhanterare är tillgänglig. Välj endast denna session.")
                try:
                    keyring.set_password("CreatorIQ", "openrouter", value)
                except Exception:
                    raise UserError("Nyckeln kunde inte sparas i systemets nyckelhanterare. Använd sessionslagring.") from None
            self._session = value

    def clear(self):
        with self._lock:
            self._session = None
            if self.secure_backend:
                try:
                    keyring.delete_password("CreatorIQ", "openrouter")
                except keyring.errors.PasswordDeleteError:
                    pass
                except Exception:
                    raise UserError("Kunde inte ta bort den lagrade nyckeln från systemets nyckelhanterare.") from None
        return {"configured": bool(self.get()), "environment_key": bool(os.environ.get("OPENROUTER_API_KEY"))}
