import argparse
import json
import os
from pathlib import Path
from uuid import uuid4
from qcloud_ai import QCloud, APIError
from .inference import chat, discover_models, stream_chat
from .services import inspect_services, invoke_dedicated, submit_generation


def required(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise ValueError(f"Set {name}.")
    return value


def main() -> None:
    parser = argparse.ArgumentParser(description="QCloud examples. Discovery is read-only; invocation commands require --run.")
    commands = parser.add_subparsers(dest="command", required=True)
    for command in ("models", "services"):
        commands.add_parser(command)
    for command in ("chat", "stream", "serverless"):
        sub = commands.add_parser(command)
        sub.add_argument("--run", action="store_true")
    init = commands.add_parser("init-generation")
    init.add_argument("model")
    init.add_argument("input_json")
    generation = commands.add_parser("generation")
    generation.add_argument("intent_file")
    generation.add_argument("--run", action="store_true")
    for command in ("job", "result"):
        commands.add_parser(command).add_argument("job_id")
    args = parser.parse_args()
    if args.command == "init-generation":
        intent = {"client_request_id": str(uuid4()), "model": args.model, "input": json.loads(args.input_json)}
        serialized = json.dumps(intent, indent=2, allow_nan=False) + "\n"
        with Path("generation-intent.json").open("x", encoding="utf-8") as target:
            target.write(serialized)
        print("Saved generation-intent.json. Review it and the model price before submission.")
        return
    if args.command in ("chat", "stream", "generation", "serverless") and not args.run:
        parser.error("This command can incur charges. Add --run after reviewing model access and rates.")
    key = required("QCLOUD_API_KEY")
    base = os.environ.get("QCLOUD_BASE_URL", "https://platform.qcloud.host/api/v1")
    prompt = "Explain vector search in two sentences."
    with QCloud(api_key=key, base_url=base, max_retries=0) as client:
        if args.command == "models":
            print(json.dumps(discover_models(client), indent=2, default=str))
        elif args.command == "chat":
            print(chat(client, required("QCLOUD_MODEL"), prompt))
        elif args.command == "stream":
            usage = stream_chat(client, required("QCLOUD_MODEL"), prompt, lambda text: print(text, end="", flush=True))
            print("\nUsage:", usage)
        elif args.command == "services":
            print(json.dumps(inspect_services(client), indent=2))
        elif args.command == "generation":
            intent = json.loads(Path(args.intent_file).read_text(encoding="utf-8"))
            print(submit_generation(client, intent).model_dump_json(indent=2))
        elif args.command == "job":
            print(client.generation.jobs.retrieve(args.job_id).model_dump_json(indent=2))
        elif args.command == "result":
            print(client.generation.jobs.result(args.job_id).model_dump_json(indent=2))
        elif args.command == "serverless":
            print(invoke_dedicated(key, base, required("QCLOUD_DEPLOYMENT_ID"), required("QCLOUD_DEPLOYMENT_MODEL"), prompt))


if __name__ == "__main__":
    try:
        main()
    except APIError as error:
        print({"status": error.status_code, "code": error.code, "request_id": error.request_id, "message": error.message})
        raise SystemExit(1)
    except (ValueError, RuntimeError, OSError) as error:
        print(str(error))
        raise SystemExit(1)
    except KeyboardInterrupt:
        print("\nConnection closed. Inspect usage before retrying.")
        raise SystemExit(130)
