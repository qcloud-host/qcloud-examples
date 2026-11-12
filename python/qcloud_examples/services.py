import json
from uuid import UUID
import httpx
from qcloud_ai import QCloud


def inspect_services(client: QCloud) -> dict:
    """Discovery only. Requires generation:read and serverless:read scopes."""
    return {
        "generation": client.generation.models.list(limit=10).model_dump(),
        "queue_catalog": client.serverless.queue.catalog().model_dump(),
        "queue_runtime": client.serverless.queue.runtime.capabilities().model_dump(),
    }


def submit_generation(client: QCloud, intent: dict):
    """Use a saved UUID and identical input for explicit recovery of an ambiguous request."""
    UUID(intent["client_request_id"])
    if not intent.get("model") or "input" not in intent:
        raise ValueError("A saved UUID, model and JSON input are required.")
    json.dumps(intent["input"], allow_nan=False)
    model = client.generation.models.retrieve(intent["model"])
    if not (model.queued_available is True and model.schema_available is True
            and model.reference_status == "current" and model.reference_stale is False):
        raise RuntimeError("This model is not available for queued execution. No job was submitted.")
    return client.generation.jobs.submit(
        model=intent["model"], input=intent["input"],
        client_request_id=intent["client_request_id"], billing_mode="metered",
    )


def invoke_dedicated(api_key: str, api_base: str, deployment_id: str, model: str, prompt: str,
                     http_client: httpx.Client | None = None):
    """Health never wakes a worker. A non-ready deployment must not receive inference."""
    UUID(deployment_id)
    if not model:
        raise ValueError("Use the deployment's exact pinned model.")
    endpoint = f"{api_base.rstrip('/')}/serverless/{deployment_id}"
    transport = http_client or httpx.Client(timeout=120, follow_redirects=False)
    with QCloud(api_key=api_key, base_url=endpoint, max_retries=0, http_client=transport) as client:
        response = transport.get(f"{endpoint}/health", headers={"Authorization": f"Bearer {api_key}"})
        if response.status_code != 200 or response.json().get("ready") is not True:
            raise RuntimeError("The deployment is not ready. No inference request was sent.")
        return client.chat.completions.create(
            model=model, messages=[{"role": "user", "content": prompt}], max_tokens=256
        )
