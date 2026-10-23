# Tailscale

- **Plan:** Premium, 1 seat, monthly, on the work card.
  Bought 2026-09-28. Chosen because the free Personal plan is non-commercial only and Standard caps
  Tailscale SSH at 5 hosts. Premium removes that cap and gives 10,000 ephemeral-node minutes a month.
  Included: 50 tagged resources (more are $1/mo each under Billing → Add-ons), unlimited user devices.
- **Policy:** `policy.hujson` here is the source of truth. Edit it, then run `ag-ts-apply-policy`
  (validates first; needs `AG_TAILNET_OWNER`, the owner's login email, which replaces the file's
  `OWNER_EMAIL` placeholder). Don't edit it in the admin console.
  - Tags: `tag:ag-engine` (the Linux engine / session host) and `tag:ag-worker` (scale-out machines).
  - The owner's devices reach everything. The engine reaches everything. Workers reach only the engine and each other.
  - Tailscale SSH (no browser check) from the owner's devices, ag-mac included, to both tags, and from the engine to workers.
  Tailscale SSH is **off** on every node since 2026-10-23 (a privilege escalation was disclosed in it); machines use plain OpenSSH with keys in ~/.ssh/authorized_keys. The policy's ssh rules stay so it can be turned back on once patched.
  Key expiry is disabled on ag-mac (always-on and unattended, so an expired key would cut it off silently) via the API: POST device/<nodeId>/key with {"keyExpiryDisabled":true} (ag-ts-api, Content-Type application/json). Tagged nodes (the engine) never expire; the owner's own devices keep expiry on.
- **Credentials** (work vault `ag-vault`, read with `op-work`):
  - `Tailscale OAuth client (ag)`: username = client ID, credential = secret. Scopes `all`, may assign
    both tags. Doesn't expire. Use for Terraform (`oauth_client_id`/`oauth_client_secret`, tailnet `-`)
    and `ag-ts-api` (any API call, e.g. `ag-ts-api GET tailnet/-/devices`).
  - `Tailscale ag auth key` (field `credential`): reusable, ephemeral, pre-authorized, tagged
    `tag:ag-engine` + `tag:ag-worker`, 90-day expiry (date in the item). Replace it before then with
    `ag-ts-mint-auth-key`. Join a machine with
    `tailscale up --auth-key="$KEY" --advertise-tags=tag:ag-worker`.
    Ephemeral nodes disappear from the tailnet when they go offline, so this key is for **workers** only.
  - The **engine** must not be ephemeral (it vanished once while stopped). `ag-infra` mints it a single-use,
    non-ephemeral, pre-authorized `tag:ag-engine` key per run (1-hour expiry) with the OAuth client. To re-join
    an existing engine by hand, mint one the same way (`ag-ts-api POST tailnet/-/keys`, `"ephemeral":false`),
    then `sudo tailscale logout && sudo tailscale up --auth-key=file:<key> --hostname=ag-engine
    --advertise-tags=tag:ag-engine` and `ag-svc local` (the Tailscale IP changes; svc:ag doesn't).
- Recreate from zero: sign into the admin console as the tailnet owner. Generate a 1-day API
  access token (Settings → Keys) and apply `policy.hujson`. Then create the OAuth client with
  `POST /api/v2/tailnet/-/keys` `{"keyType":"client","scopes":["all"],"tags":[…]}`, store it as above,
  run `ag-ts-mint-auth-key`, and revoke the temporary token.
