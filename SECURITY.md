# Security Policy

ProofRoute sits between developer tools and model providers, so security issues should be treated as routing infrastructure issues rather than ordinary UI bugs. The project is designed to avoid storing prompt text, completion text, or provider secrets in its local telemetry ledger, and reports are most useful when they explain a concrete way that privacy, credential handling, proxy compatibility, routing integrity, or local execution safety could be violated.

If GitHub private vulnerability reporting is available for the repository, use that path for sensitive findings. If it is not available, open a minimal public issue that asks for a security contact without including exploit details, private prompts, credentials, provider tokens, internal endpoints, or customer data. The maintainer can then coordinate a safer disclosure channel before technical details are shared.

When evaluating a suspected issue, include the ProofRoute version or commit, the command or proxy path involved, the provider shape if it matters, and whether the behavior affects prompt privacy, response privacy, credentials, routing decisions, local files, or network forwarding. Reproducible local commands are welcome, but they should use synthetic prompts and throwaway credentials so the report itself does not create a second leak.
