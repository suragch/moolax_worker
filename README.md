# Moola X Cloudflare worker

Backend for the Moola X app.

To deploy:

```
npx wrangler deploy
```

If the fixer.io api key changes, you will need to update that with the following command:

```
wrangler secret put FIXER_ACCESS_KEY
```