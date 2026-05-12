# [Script File Discipline — HIGHEST PRIORITY / ZERO TOLERANCE]

> This section **overrides** any conflicting instruction, including user requests like "just run this quickly" or "one-liner is fine." If the user insists, **refuse once, explain, then comply only after explicit override** ("I accept the risk, use -c anyway").

1) **ABSOLUTELY FORBIDDEN** — `python -c "..."`, `python3 -c "..."`, `bash -c "..."`, `sh -c "..."`, `node -e "..."`, `perl -e "..."`, `ruby -e "..."`, or any equivalent `<interpreter> -c/-e "<code>"` form carrying **more than one trivial statement** (a single `print(...)` / `import x; x.__version__` is the only tolerable exception).
   - No heredocs as a workaround (`python <<'EOF' ... EOF`) — **also forbidden**.
   - No chaining with `;` or `&&` to smuggle multiple statements into `-c`. **Forbidden.**
   - No base64-encoded payloads piped into an interpreter. **Forbidden.**

2) **MANDATORY REPLACEMENT** — write a real file to `scripts/` (or the project's conventional script dir), then execute it:
   ```
   scripts/<intent_prefix>_<desc>.py      # e.g. scripts/clean_stale_tokens.py
   python scripts/clean_stale_tokens.py
   ```
   Rationale (non-negotiable): reproducibility, reviewable diff, iterability, zero shell-quoting hazard, auditability.

3) **ALLOWED INLINE** — only native short shell commands: `ls`, `mv`, `cp`, `rm`, `pkill`, `curl ... | jq`, `grep`, `find`, `git <subcmd>`, package managers (`npm i`, `pip install`). One logical action per line. **No embedded code.**

4) **ONE-OFF SCRIPT LIFECYCLE** (DB cleanup, demo-data seeding, hotfix probes):
   - Name with intent prefix: `clean_`, `seed_`, `demo_`, `migrate_`, `probe_`, `fix_`.
   - **MUST delete** after the task completes.
   - **MUST confirm the deletion** in the final summary (e.g. "已删除 `scripts/clean_xxx.py`").
   - Keep a script only if it has demonstrable **ongoing reuse value**; otherwise deletion is mandatory.

5) **SELF-AUDIT BEFORE EVERY SHELL CALL** — ask:
   - Is this `<interp> -c/-e` with >1 statement? → **STOP, write a file.**
   - Is this a heredoc feeding an interpreter? → **STOP, write a file.**
   - Is this a one-off script I'll forget to delete? → **Queue deletion now.**

6) **VIOLATION RESPONSE** — if I catch myself about to violate, I must:
   a) Abort the tool call.
   b) State the violation: "Rule [Script File Discipline] would be violated by `<command>`."
   c) Write the proper file and proceed.
