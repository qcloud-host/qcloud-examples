# QCloud examples

Small, runnable Python and TypeScript examples for building with [QCloud Host](https://qcloud.host). Start with model discovery, make a chat request, then stream the response. Separate service examples show how to inspect capabilities and handle access-gated generation and dedicated inference.

These examples use the [Python SDK from PyPI](https://pypi.org/project/qcloud-ai/0.4.0/) and the [TypeScript SDK from GitHub Releases](https://github.com/qcloud-host/qcloud-typescript/releases/tag/v0.4.0). Both use version 0.4.0. Exact source revisions are in [sdk-sources.json](sdk-sources.json).

| Example | TypeScript | Python | What it demonstrates |
| --- | --- | --- | --- |
| Model discovery | [inference.ts](typescript/inference.ts) | [inference.py](python/qcloud_examples/inference.py) | Exact IDs, capabilities and returned prices |
| Chat | [inference.ts](typescript/inference.ts) | [inference.py](python/qcloud_examples/inference.py) | A bounded request and its usage |
| Streaming | [inference.ts](typescript/inference.ts) | [inference.py](python/qcloud_examples/inference.py) | Incremental text, final usage, incomplete-stream errors and cleanup |
| Service discovery | [services.ts](typescript/services.ts) | [services.py](python/qcloud_examples/services.py) | Generation catalog and inactive queue capabilities |
| Queued generation | [services.ts](typescript/services.ts) | [services.py](python/qcloud_examples/services.py) | Availability checks, durable request identity and explicit billing acceptance |
| Dedicated inference | [services.ts](typescript/services.ts) | [services.py](python/qcloud_examples/services.py) | Deployment health and the correct invocation base URL |

## Requirements

- Node.js 20 or later for TypeScript, or Python 3.10 or later for Python.
- An internet connection to install dependencies.
- A QCloud API key only when running against your workspace. Tests require no key and send no API traffic.

Install either language, or both. Commands below run from the repository root.

## TypeScript setup

```sh
npm ci
npm run example -- help
```

`npm ci` downloads the tagged SDK archive and verifies it against the integrity hash in `package-lock.json`.

## Python setup

```sh
python -m venv .venv
```

Activate the environment:

```sh
# macOS / Linux
source .venv/bin/activate
export PYTHONPATH=python
```

```powershell
# Windows PowerShell
.\.venv\Scripts\Activate.ps1
$env:PYTHONPATH = "python"
```

Then install the pinned SDK release from PyPI:

```sh
python -m pip install -r requirements.txt
python -m qcloud_examples --help
```

## Configure your workspace

Create a key in the QCloud console and keep it on your server. Examples read environment variables directly; `.env.example` is a reference and is **not loaded automatically**.

```sh
# macOS / Linux
export QCLOUD_API_KEY="YOUR_QCLOUD_API_KEY"
export QCLOUD_BASE_URL="https://platform.qcloud.host/api/v1"
```

```powershell
# Windows PowerShell
$env:QCLOUD_API_KEY = "YOUR_QCLOUD_API_KEY"
$env:QCLOUD_BASE_URL = "https://platform.qcloud.host/api/v1"
```

Do not put a key in a browser bundle, source file, issue or screenshot. The `.gitignore` excludes local environment files and generation intents. Review staged files before committing.

## Discover a model, then invoke it

```sh
npm run example -- models
# or
python -m qcloud_examples models
```

Copy an exact chat-capable ID into `QCLOUD_MODEL`. A catalog entry is not a guarantee of account access or upstream availability. Check capabilities and the current price before making a request.

```sh
export QCLOUD_MODEL="COPY_A_CATALOG_MODEL_ID"
```

```powershell
$env:QCLOUD_MODEL = "COPY_A_CATALOG_MODEL_ID"
```

Invocation commands require `--run` because they may incur usage charges:

```sh
npm run example -- chat --run
npm run example -- stream --run
# or
python -m qcloud_examples chat --run
python -m qcloud_examples stream --run
```

Both examples ask for a short explanation of vector search and request at most 256 output tokens. This token bound is not a currency spending cap. Streaming writes text as it arrives and reports usage after completion. Press Ctrl+C to close the connection. Closing a stream does not guarantee that upstream computation stopped or that no usage was incurred.

Clients use zero automatic retries so failures are visible at the call site. Do not blindly replay a chat request after a timeout: it may already have been dispatched. Partial streamed text is not evidence of a successfully completed response.

## Inspect service capabilities

```sh
npm run example -- services
# or
python -m qcloud_examples services
```

This reads the generation catalog, queue catalog and queue runtime capabilities. The key needs `generation:read` and `serverless:read` scopes. An error in one service is surfaced rather than silently reported as an empty catalog.

At the documented service baseline, generation execution and dedicated serverless are access-gated. The queue is a draft preview with execution and billing inactive. These examples do not enable services, launch workers or turn draft deployments into running endpoints. Use live responses as the authority for your workspace.

## Queued generation: preserve the intent

Use a model's current input schema to prepare its JSON input. There is no universal image/video input schema. The JSON below illustrates a prompt field; replace it with the actual required input before submission.

```sh
npm run example -- init-generation "EXACT_GENERATION_MODEL_ID" '{"prompt":"A quiet observatory"}'
# or
python -m qcloud_examples init-generation "EXACT_GENERATION_MODEL_ID" '{"prompt":"A quiet observatory"}'
```

This local command creates `generation-intent.json` with a UUID, model and input. It makes no API request and refuses to overwrite an existing intent. PowerShell users can edit the generated file if their shell's JSON quoting differs.

Review the input, model price and access, then submit the saved intent:

```sh
npm run example -- generation generation-intent.json --run
# or
python -m qcloud_examples generation generation-intent.json --run
```

The example checks `queued_available`, `schema_available` and reference freshness before the POST. Passing these checks does not guarantee admission: the API still enforces scopes, input policy, balance and workspace access. Submission explicitly accepts `billing_mode: "metered"`; it is not a fixed-price quote.

Keep the same UUID **and identical model/input** after an ambiguous submission failure. A new UUID represents a new job and may duplicate the work. The helper never resubmits automatically. Store the returned job ID and inspect it separately:

```sh
npm run example -- job JOB_UUID
npm run example -- result JOB_UUID
# or
python -m qcloud_examples job JOB_UUID
python -m qcloud_examples result JOB_UUID
```

Result retrieval may return a pending-job envelope. Check status before consuming output; handle `failed`, `cancelled` and `review` explicitly. These commands do not automatically poll, cancel or download files. See the [generation guide](https://qcloud.host/docs#generation) for those workflows.

## Dedicated serverless: check readiness

Use an already-enabled deployment and its exact pinned model:

```sh
export QCLOUD_DEPLOYMENT_ID="YOUR_DEPLOYMENT_UUID"
export QCLOUD_DEPLOYMENT_MODEL="YOUR_DEPLOYMENT_MODEL"
npm run example -- serverless --run
# or
python -m qcloud_examples serverless --run
```

Set the same variables with `$env:NAME = "value"` in PowerShell. The key needs `serverless:invoke`. The helper checks health first and stops if the deployment is cold, paused or unavailable. Health does not wake a worker. This example requires readiness and does not implement cold-start retries.

The invocation base is:

```text
https://platform.qcloud.host/api/v1/serverless/DEPLOYMENT_UUID
```

The SDK appends `/chat/completions`. Do not append another `/v1`. Readiness can change between health and invocation; handle the returned API error. See [serverless documentation](https://qcloud.host/docs#serverless) for lifecycle and billing behavior.

## Run the offline checks

```sh
npm run check
python -m unittest discover -s python/tests -v
```

Run Python with the environment activated and `PYTHONPATH=python` as above. Tests use the real SDKs with injected HTTP transports and an `offline.invalid` host. They cover request construction, Unicode streaming, missing terminal events, disabled/stale generation, preserved UUIDs, non-replayed submissions, inactive queue capabilities and dedicated endpoint paths. No live key or model execution is used. CI runs the same checks on Linux and Windows.

Fixtures contain illustrative model names and prices. They are not a QCloud catalog or pricing source.

## Help and contributions

- [QCloud documentation](https://qcloud.host/docs) covers authentication, compatibility, services and workspace operations.
- [Python SDK examples](https://github.com/qcloud-host/qcloud-python/tree/main/examples) and [TypeScript SDK examples](https://github.com/qcloud-host/qcloud-typescript/tree/main/examples) cover more SDK features.
- Report SDK bugs in the corresponding repository with the SDK version, request ID and a minimal reproduction. Remove keys and private inputs.
- Contact [info@qcloud.host](mailto:info@qcloud.host) for account, billing or private support questions.

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).
