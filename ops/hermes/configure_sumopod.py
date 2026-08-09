from pathlib import Path
import sys

from ruamel.yaml import YAML


def main() -> None:
    config_path = Path(sys.argv[1])
    yaml = YAML()
    yaml.preserve_quotes = True

    with config_path.open("r", encoding="utf-8") as config_file:
        config = yaml.load(config_file) or {}

    model = config.setdefault("model", {})
    model["provider"] = "custom:sumopod"
    model["default"] = "deepseek-v4-flash"
    model.pop("base_url", None)
    model.pop("api_key", None)

    providers = config.setdefault("providers", {})
    providers["sumopod"] = {
        "name": "SumoPod",
        "api": "https://ai.sumopod.com/v1",
        "key_env": "OPENAI_API_KEY",
        "default_model": "deepseek-v4-flash",
        "transport": "chat_completions",
    }

    agent = config.setdefault("agent", {})
    agent["max_turns"] = 4
    agent["reasoning_effort"] = "none"

    display = config.setdefault("display", {})
    display_platforms = display.setdefault("platforms", {})
    whatsapp_display = display_platforms.setdefault("whatsapp", {})
    whatsapp_display.update(
        {
            "tool_progress": "off",
            "streaming": False,
            "interim_assistant_messages": False,
            "long_running_notifications": False,
            "busy_ack_detail": False,
        }
    )

    with config_path.open("w", encoding="utf-8") as config_file:
        yaml.dump(config, config_file)


if __name__ == "__main__":
    main()
