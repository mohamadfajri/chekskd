# Hermes deployment for cpnsguru.id

This directory contains the non-secret deployment files for the public SKD
WhatsApp assistant. Runtime data and credentials live in `data/`, which is
ignored by Git.

The container is isolated from TeamSMT:

- container: `hermes-cpnsguru`
- memory limit: 1 GiB
- CPU limit: 1 core
- persistent data: `/opt/hermes-cpnsguru/data`

The dashboard is bound to VPS loopback only. From the owner's Windows laptop,
open an SSH tunnel and keep that terminal running:

```powershell
ssh -N -L 9119:127.0.0.1:9119 -i "$HOME\.ssh\smt.pem" ubuntu@43.157.212.126
```

Then open `http://127.0.0.1:9119`. Dashboard credentials stay only in
`data/.env` on the VPS.

WhatsApp uses the Business app through Linked Devices (QR/Baileys). It does
not need a Meta application or a public webhook. Keep the paired session under
`data/whatsapp/session` private because it grants access to the bot account.

Pair the account from the VPS with:

```bash
cd /opt/hermes-cpnsguru
sudo docker compose run --rm hermes whatsapp
```

Scan the displayed QR in WhatsApp Business under **Linked Devices**. Then start
the service with `sudo docker compose up -d`.

Messages matching `CEK RSKD-...` are handled directly by the `skd-result`
plugin. The score, ranking, recommendation, and PNG are always produced by the
deterministic application engine. When `SKD_AI_EXPLANATION_ENABLED=true`, one
short coaching note is appended to the same image caption. If the provider is
unavailable or its output fails the guard, Hermes sends the deterministic
caption unchanged. `HERMES_API_SECRET` must match the server-only Vercel value.

Other conversations can still use the named `custom:sumopod`
OpenAI-compatible endpoint with the `deepseek-v4-flash` model. Store its
secret only in `data/.env`:

```dotenv
OPENAI_BASE_URL=https://ai.sumopod.com/v1
OPENAI_API_KEY=replace-with-sumopod-api-key
SKD_AI_EXPLANATION_ENABLED=true
SKD_AI_MODEL=deepseek-v4-flash
```

Only the custom `skd_result` toolset should be enabled for WhatsApp. Do not
enable the default `hermes-whatsapp` toolset for this public bot because it
includes terminal, file, browser, and other general-purpose tools.

Telegram is reserved for the owner. Configure the BotFather token and numeric
owner ID only in the VPS `data/.env`, set the same ID as the home channel, and
keep `TELEGRAM_ALLOW_ALL_USERS=false`. After restarting the gateway, open the
bot in Telegram and send `/start`. The allowlist prevents other Telegram
accounts from using the agent. Apply `TELEGRAM_OWNER_PROMPT.md` as the owner's
Telegram `channel_prompts` entry so this channel behaves as an operations
console instead of inheriting the public SKD assistant behavior. Keep its
toolsets limited to `terminal`, `file`, `web`, `session_search`, `cronjob`,
`memory`, `todo`, and `clarify`; explicitly mark `skd_result` as known but
disabled for Telegram. Hide Telegram tool progress and interim messages so the
owner receives only the final operational result.

To replace an expired SumoPod key without putting it in shell history, run from
the repository root on Windows:

```powershell
powershell -ExecutionPolicy Bypass -File ops\hermes\update_sumopod_key.ps1
```

The script validates the key against SumoPod before restarting Hermes and
restores the previous VPS configuration if validation fails.
