# Daily Microsoft Graph report bootstrap

The reporting path uses only delegated Microsoft Graph `Mail.Send` and `offline_access`; it does
not require a paid service. Register a free public-client application in Microsoft Entra, allow
personal Microsoft accounts, enable the device-code/public-client flow, and add delegated
`Mail.Send`.

Run the one-time login locally so the device code is never exposed in public GitHub Actions logs:

```sh
export GRAPH_CLIENT_ID='<public client application id>'
export GRAPH_TOKEN_CACHE_KEY='<long random value>'
python3 automation/reporting/graph_mail.py bootstrap --output graph-token-cache.enc
gh secret set GRAPH_CLIENT_ID --body "$GRAPH_CLIENT_ID" --repo walter-erquinigo/paseito
gh secret set GRAPH_TOKEN_CACHE_KEY --body "$GRAPH_TOKEN_CACHE_KEY" --repo walter-erquinigo/paseito
base64 < graph-token-cache.enc | gh secret set GRAPH_TOKEN_CACHE_SEED --repo walter-erquinigo/paseito
```

Delete `graph-token-cache.enc` after setting the secrets. Daily runs rotate the encrypted cache as
a short-lived Actions artifact. No access or refresh token is committed or printed.
