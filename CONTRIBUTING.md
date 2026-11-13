# Contributing

Keep examples small enough to read in one sitting and useful outside this repository. Each should explain one workflow with the real SDK, handle its response and close open streams and clients.

1. Follow the README setup and create a branch.
2. Update Python and TypeScript together when both SDKs expose the feature.
3. Use exact catalog IDs supplied by the reader. Keep availability and access checks explicit.
4. Add offline transport tests for the request contract and a meaningful failure case. Tests must not need API keys or access live QCloud endpoints.
5. Run `npm run check` and `python -m unittest discover -s python/tests -v` with `PYTHONPATH=python`.
6. Describe the workflow, verified SDK revision and test results in your pull request.

Do not add credentials, customer inputs, generated assets or local intent files. Do not silently retry potentially dispatched paid requests. For generation recovery, keep the saved UUID and identical body together.

When updating an SDK, record the source revision in `sdk-sources.json`. For Python, pin the corresponding PyPI release in `requirements.txt`. For TypeScript, update the GitHub release asset URL in `package.json`, verify the asset against the release checksum, and regenerate `package-lock.json`. Rerun both test suites and explain changed API assumptions in the README.

Use GitHub issues for reproducible code problems. Keep account questions and security reports private; see SECURITY.md.
