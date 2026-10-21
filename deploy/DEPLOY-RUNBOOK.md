# Deploy runbook — `ce1df1b` → current

The production VPS has been stuck at `ce1df1b` since the campaign work began.
This runbook covers the fourteen-commit jump, which is larger than a normal
deploy and includes eighteen new server files.

**Every step is labelled with the machine it runs on.** The two have been
mixed up repeatedly; the VPS prompt reads `root@srv1376728`, a Windows prompt
does not.

---

## Why two remotes

The public repo is a single orphan commit with no history in common with the
VPS checkout, and it deliberately excludes `deploy/` and `ecosystem.config.cjs`
— the deploy machinery itself. Pointing production at it means `git pull`
cannot merge, and a `reset --hard` would delete `redeploy.sh` mid-run.

So:

| Remote | Contains | Used by |
|---|---|---|
| `public` | one sanitized commit, no deploy scripts | whoever the repo is published for |
| `deploy` (private) | real `main`, full history, deploy scripts | the VPS |

Both live under the same account, which satisfies the "work only through the
separate account" requirement. Nothing says the deploy source must be public.

The private remote shares ancestry with the VPS checkout, so `git pull` is an
ordinary fast-forward. No history surgery.

---

## Phase 0 — one-time, Windows

Create a **private** repo on the new GitHub account. Then:

```
git remote add deploy https://github.com/<account>/<private-repo>.git
git push -u deploy main
```

Username at the prompt is the account; password is the Personal Access Token.

---

## Phase 1 — prepare the VPS

Three files are locally modified there and `git pull` will refuse until they
are reverted. This is why the server stopped advancing.

```
cd /var/www/tododjs && git status --short
```

Back up anything you cannot replace, then revert the tracked modifications:

```
cd /var/www/tododjs && cp deploy/redeploy.sh ~/redeploy.sh.bak && git checkout -- deploy/redeploy.sh package-lock.json server/package-lock.json
```

`~/redeploy.sh.bak` preserves whatever was changed by hand, in case those edits
mattered. Compare it against the repo version afterwards.

Repoint at the private remote:

```
cd /var/www/tododjs && git remote set-url origin https://github.com/<account>/<private-repo>.git && git remote -v
```

---

## Phase 2 — environment

Two new variables since `ce1df1b`. Both fail safe when absent, so neither
blocks the deploy.

**`CAMPAIGN_AUTOMATION_ENABLED`** — leave it UNSET. It gates the campaign
scheduler and the sequence engine together. Absent means no automated mail can
go out, which is the required state until the admin decides otherwise.

**`RESEND_WEBHOOK_SECRET`** — optional. Without it the Resend bounce webhook
returns 503 rather than trusting unsigned events, so bounce and complaint
handling stays inert until it is configured. Set it when you add the endpoint
in the Resend dashboard.

Confirm the frontend build variables are present — these are inlined at build
time, and without them the privacy policy ships with no contact details:

```
cd /var/www/tododjs && cat .env.production.local
```

Expect `VITE_CONTACT_EMAIL` and `VITE_CONTACT_ADDRESS`.

---

## Phase 3 — deploy

```
cd /var/www/tododjs && git pull origin main
```

No dependency changes in this jump — `package.json` is identical at both ends
— so `npm install` is not required. Run it only if the pull reports changes to
either `package.json`.

Build the frontend:

```
cd /var/www/tododjs && npm run build
```

Syntax-check the server before restarting. A failure here is a bad checkout,
and reloading on top of it takes the API down for everyone:

```
cd /var/www/tododjs/server && for f in $(git ls-files '*.js' | grep -v node_modules); do node --check "$f" || echo "BROKEN $f"; done; echo "check complete"
```

Reload. `reload` rather than `restart` — PM2 runs two instances in cluster
mode and this keeps it zero-downtime:

```
pm2 reload tododjs-api
```

---

## Phase 4 — verify

```
curl -s https://api.tododjs.com/api/health; echo
```

Wants `"success":true` and `database: connected`.

Confirm the schedulers came up in the intended state:

```
pm2 logs tododjs-api --lines 40 --nostream | grep -E 'scheduled|not scheduled|designated runner'
```

Expect the reconciler and access-drift monitor scheduled on instance 0 and
skipped on instance 1, and both the welcome campaign and campaign automation
reporting **not scheduled**. Anything else means a switch is on that should
not be.

Confirm the new routes are mounted — these should answer 401, not 404. A 404
means the routes did not register:

```
for p in campaigns sequences coupons; do printf "%-12s %s\n" "$p" "$(curl -s -o /dev/null -w '%{http_code}' https://api.tododjs.com/api/$p)"; done
```

Then the money checks:

```
cd /var/www/tododjs/server && node scripts/verify-payment-recovery.mjs
```

```
cd /var/www/tododjs/server && node scripts/track-unpaid-downloaders.mjs
```

The second should stop growing after this deploy. New over-grants were being
created at every failed renewal and re-created hourly by the reconciler; both
writers now require evidence of payment. The existing records are not repaired
by deploying — see below.

---

## Phase 5 — after the deploy

**Do not revoke immediately.** Twenty-two accounts hold access one month
beyond what they paid for. Every corrected date is already in the past, so
applying the revocation cuts all of them off at once.

Deploying first means the failed-payment email now carries a Stripe pay link,
so those customers have a route back. Email them, wait, then revoke whoever
has not paid:

```
cd /var/www/tododjs/server && node scripts/revoke-overgranted-access.mjs
```

Dry run by default. `--apply` writes.

---

## Rollback

PM2 keeps the previous process; the code is in git. To go back:

```
cd /var/www/tododjs && git reset --hard ce1df1b && npm run build && pm2 reload tododjs-api
```

This reverts code only. It does not undo database writes, and nothing in this
deploy migrates data — the fixes change what gets written from now on, not
what is already stored. So a rollback is safe at any point.

---

## What this deploy contains

- **Payment recovery**: the failed-payment email carries the Stripe invoice
  link, so paying it restores access with no admin action.
- **Over-granting fixed**: `endDate` now advances on evidence of payment
  rather than on subscription status, in both the webhook handler and the
  reconciler.
- **Boot resilience**: a missing `RESEND_API_KEY` no longer prevents the API
  starting.
- **Discount integrity**: deleting a campaign can no longer silently turn its
  per-recipient code into an unlimited public discount.
- **Contact details from config**, so no address is in the published source.
- **Campaigns, sequences, suppression, open/click tracking** — all dormant
  until `CAMPAIGN_AUTOMATION_ENABLED` is set.
- Three read-only audit scripts: `verify-payment-recovery`,
  `track-unpaid-downloaders`, `clear-redundant-admin-grants`.
