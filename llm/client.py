import requests


class LLMClient:
    """统一封装：Ollama / OpenAI 兼容 API（DeepSeek、Claude-via-proxy 等）"""

    def __init__(self, config: dict):
        self.provider = config["provider"]          # "ollama" | "openai_compatible"
        self.model = config["model"]
        self.base_url = config["base_url"].rstrip("/")
        self.api_key = config.get("api_key", "")
        self.temperature = config.get("temperature", 0.3)
        self.max_tokens = config.get("max_tokens", 4096)

    def generate(self, system: str, user: str) -> str:
        if self.provider == "ollama":
            return self._ollama(system, user)
        return self._openai_compat(system, user)

    # ------------------------------------------------------------------
    def _ollama(self, system: str, user: str) -> str:
        resp = requests.post(
            f"{self.base_url}/api/chat",
            json={
                "model": self.model,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                "stream": False,
                "options": {"temperature": self.temperature},
            },
            timeout=120,
        )
        resp.raise_for_status()
        return resp.json()["message"]["content"]

    def _openai_compat(self, system: str, user: str) -> str:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        resp = requests.post(
            f"{self.base_url}/v1/chat/completions",
            json={
                "model": self.model,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                "temperature": self.temperature,
                "max_tokens": self.max_tokens,
            },
            headers=headers,
            timeout=120,
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]
