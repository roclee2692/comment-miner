import requests


class LLMClient:
    """统一封装：Ollama / OpenAI 兼容 API（DeepSeek、Claude-via-proxy 等）"""

    def __init__(self, config: dict):
        self.provider = config["provider"]          # "ollama" | "openai_compatible"
        self.model = config["model"]
        self.base_url = config.get("base_url", "").rstrip("/")
        self.api_key = config.get("api_key", "")
        self.temperature = config.get("temperature", 0.3)
        self.max_tokens = config.get("max_tokens", 4096)

        if not self.model:
            raise ValueError("LLM config 缺少 model 字段")
        if not self.base_url:
            raise ValueError("LLM config 缺少 base_url 字段")

    def generate(self, system: str, user: str) -> str:
        if self.provider == "ollama":
            return self._ollama(system, user)
        return self._openai_compat(system, user)

    # ------------------------------------------------------------------
    def _ollama(self, system: str, user: str) -> str:
        try:
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
                timeout=180,
            )
        except requests.ConnectionError:
            raise ConnectionError(
                f"无法连接 Ollama ({self.base_url})，请确认 Ollama 正在运行 (ollama serve)"
            )
        except requests.Timeout:
            raise TimeoutError(f"Ollama 响应超时（180s），模型 {self.model} 可能过大或正在加载")

        if resp.status_code != 200:
            detail = resp.text[:300]
            raise RuntimeError(f"Ollama 返回 {resp.status_code}: {detail}")

        body = resp.json()
        if "error" in body:
            raise RuntimeError(f"Ollama 错误: {body['error']}")
        return body.get("message", {}).get("content", "")

    def _openai_compat(self, system: str, user: str) -> str:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        # Gemini 的 OpenAI 兼容端点已包含版本路径 (/v1beta/openai)
        # 其他 API (OpenAI/DeepSeek) 需要加 /v1
        if self.base_url.rstrip("/").endswith("/openai") or "/v1" in self.base_url:
            url = f"{self.base_url}/chat/completions"
        else:
            url = f"{self.base_url}/v1/chat/completions"

        try:
            resp = requests.post(
                url,
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
                timeout=180,
            )
        except requests.ConnectionError:
            raise ConnectionError(f"无法连接 API ({self.base_url})，请检查网络和 base_url")
        except requests.Timeout:
            raise TimeoutError(f"API 响应超时（180s），模型: {self.model}")

        if resp.status_code == 401:
            raise RuntimeError("API Key 无效或已过期，请检查 api_key 配置")
        if resp.status_code == 429:
            raise RuntimeError("API 请求频率超限，请稍后重试")
        if resp.status_code == 404:
            raise RuntimeError(f"模型 {self.model} 不存在，请检查 model 名称")
        if resp.status_code != 200:
            detail = resp.text[:300]
            raise RuntimeError(f"API 返回 {resp.status_code}: {detail}")

        body = resp.json()
        if "error" in body:
            raise RuntimeError(f"API 错误: {body['error'].get('message', body['error'])}")

        choices = body.get("choices")
        if not choices:
            raise RuntimeError(f"API 返回了空的 choices: {str(body)[:200]}")
        return choices[0].get("message", {}).get("content", "")
