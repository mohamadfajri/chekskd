import json
import os
import sys
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def main() -> None:
    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    base_url = os.environ.get("OPENAI_BASE_URL", "").rstrip("/")

    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not configured")
    if base_url != "https://ai.sumopod.com/v1":
        raise RuntimeError("OPENAI_BASE_URL is not the expected SumoPod endpoint")

    payload = {
        "model": "deepseek-v4-flash",
        "messages": [
            {
                "role": "user",
                "content": "Call the echo tool with text ping. Do not answer directly.",
            }
        ],
        "tools": [
            {
                "type": "function",
                "function": {
                    "name": "echo",
                    "description": "Echo a short test value.",
                    "parameters": {
                        "type": "object",
                        "properties": {"text": {"type": "string"}},
                        "required": ["text"],
                        "additionalProperties": False,
                    },
                },
            }
        ],
        "tool_choice": "auto",
        "max_tokens": 128,
        "temperature": 0,
    }
    request = Request(
        f"{base_url}/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urlopen(request, timeout=30) as response:
            body = json.load(response)
    except HTTPError as error:
        error_body = error.read().decode("utf-8", errors="replace")[:1000]
        print(json.dumps({"http_status": error.code, "error": error_body}))
        sys.exit(2)
    except URLError as error:
        print(json.dumps({"network_error": str(error.reason)}))
        sys.exit(3)

    message = body.get("choices", [{}])[0].get("message", {})
    tool_calls = message.get("tool_calls") or []
    result = {
        "model": body.get("model"),
        "finish_reason": body.get("choices", [{}])[0].get("finish_reason"),
        "tool_calls": [
            {
                "name": call.get("function", {}).get("name"),
                "arguments": call.get("function", {}).get("arguments"),
            }
            for call in tool_calls
        ],
    }
    print(json.dumps(result))

    if not any(call.get("name") == "echo" for call in result["tool_calls"]):
        sys.exit(4)


if __name__ == "__main__":
    main()
