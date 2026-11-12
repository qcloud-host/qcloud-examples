from collections.abc import Callable
from qcloud_ai import QCloud


def discover_models(client: QCloud) -> list[dict]:
    """Read IDs and capabilities without sending a model request."""
    return [
        {"id": model.id, "capabilities": model.capabilities or [], "pricing": model.pricing}
        for model in client.models.list().data
    ]


def chat(client: QCloud, model: str, prompt: str) -> dict:
    response = client.chat.completions.create(
        model=model, messages=[{"role": "user", "content": prompt}], max_tokens=256
    )
    return {"text": response.choices[0].message.content, "usage": response.usage}


def stream_chat(client: QCloud, model: str, prompt: str, on_text: Callable[[str], None]):
    """The context closes the stream on errors or KeyboardInterrupt. Await final usage."""
    usage = None
    with client.chat.completions.create(
        model=model, messages=[{"role": "user", "content": prompt}], max_tokens=256,
        stream=True, stream_options={"include_usage": True},
    ) as stream:
        for chunk in stream:
            if chunk.choices and chunk.choices[0].delta.content:
                on_text(chunk.choices[0].delta.content)
            if chunk.usage:
                usage = chunk.usage
    return usage
