# Tailscale (tailnet `nathankoerschner@gmail.com`, `tail44736d.ts.net`)

- **Plan:** Premium, 1 seat, $18/mo + tax (≈ $19.19), monthly, on the Superbuilder Ramp card (Visa 8981).
  Bought 2026-09-28. Chosen because the free Personal plan is non-commercial only and Standard caps
  Tailscale SSH at 5 hosts. Premium removes that cap and gives 10,000 ephemeral-node minutes a month.
  Included: 50 tagged resources (more are $1/mo each under Billing → Add-ons), unlimited user devices.
- **Policy:** `policy.hujson` here is the source of truth. Edit it, then run `ts-apply-policy`
  (validates first). Don't edit it in the admin console.
  - Tags: `tag:ag-engine` (the Linux engine / Herdr server) and `tag:ag-worker` (scale-out machines).
  - Nathan's devices reach everything. The engine reaches everything. Workers reach only the engine and each other.
  - Tailscale SSH (no browser check) from Nathan's devices, ag included, to both tags, and from the engine to workers.
- **Credentials** (Trilogy vault `ag-vault`, `c3qkbcqktsxmi6hnpzpltdbose`, read with `op-work`):
  - `Tailscale OAuth client (ag)`: username = client ID, credential = secret. Scopes `all`, may assign
    both tags. Doesn't expire. Use for Terraform (`oauth_client_id`/`oauth_client_secret`, tailnet `-`)
    and `ts-api` (any API call, e.g. `ts-api GET tailnet/-/devices`).
  - `Tailscale ag auth key` (field `credential`): reusable, ephemeral, pre-authorized, tagged
    `tag:ag-engine` + `tag:ag-worker`, 90-day expiry (date in the item). Replace it before then with
    `ts-mint-auth-key`. Join a machine with
    `tailscale up --auth-key="$KEY" --advertise-tags=tag:ag-engine --ssh` (or `tag:ag-worker`).
    Ephemeral nodes disappear from the tailnet when they go offline.
- Recreate from zero: sign into the admin console as nathankoerschner@gmail.com. Generate a 1-day API
  access token (Settings → Keys) and apply `policy.hujson`. Then create the OAuth client with
  `POST /api/v2/tailnet/-/keys` `{"keyType":"client","scopes":["all"],"tags":[…]}`, store it as above,
  run `ts-mint-auth-key`, and revoke the temporary token.
