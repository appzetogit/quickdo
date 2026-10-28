# Recurring payload injection in `Frontend/vite.config.js`

Findings from tracing the seven "strip the EtherHiding payload" commits. Written
down because the important parts are timestamps and open questions, and both get
lost in a chat log.

**Status: the source of the injection is NOT in this repository and has not been
found.** Everything below is scoping and containment, not a fix.

---

## What it is

An obfuscated JavaScript payload appended to `Frontend/vite.config.js`, after
several hundred TAB characters so that in an editor it sits far off the right-hand
edge of a line that looks perfectly normal. The infected file carries a single line
of **32,013 characters**.

It assigns `global.i = 'A8-3388-2'` — a campaign or victim identifier — and is
EtherHiding: it fetches its real instructions from a blockchain contract, so there
is no domain to block and no takedown to wait for.

`vite.config.js` is a file the build **executes**. A payload there runs with the
developer's privileges on whatever machine builds, and can fold itself into the
shipped bundle.

---

## Exposure: `main` carried it for roughly nine days

The payload was not merely present in working trees. It was **committed**, each
time swept up by an ordinary feature commit whose author was not looking at
`vite.config.js`.

| infected from | until | duration | committed by |
|---|---|---|---|
| 08-22 18:45 | 08-25 17:26 | ~3 days | `d90a01d` feat(food): desktop split-screen layout |
| 08-27 18:08 | 08-31 13:30 | ~4 days | `e5dedc1` feat(food): inline form validation |
| 08-31 18:38 | 09-01 11:24 | ~17 hours | `47b1f0c` fix(food): finish the Cloudinary migration |
| 09-01 11:29 | 09-01 12:05 | ~36 min | `1997992` build: refuse to build source carrying an injected payload |
| 09-08 18:42 | 09-09 12:00 | ~17 hours | `e83d169` fix(pricing): revert reset the menu |
| 09-15 16:27 | 09-15 17:43 | ~76 min | `eec8f23` fix(payout): the percentage beside the tax |
| 09-15 19:02 | 09-16 12:34 | ~17.5 hours | `4a78bad` feat(cart): the priced trip distance |

`1997992` is the commit that ADDED the integrity guard, and it is itself infected.

---

## Did it ship?

**Through GitHub Actions: almost certainly not, since 2026-09-01.**

- `.github/workflows/deploy.yml` is `workflow_dispatch` only. Push-to-main
  auto-deploy is commented out, so nine days of infected `main` did not deploy
  themselves.
- The deploy runs `npm run build` in `Frontend`, and that script begins with
  `node scripts/check-source-integrity.mjs`. Verified against the genuine payload:
  the guard stops the build.
- So a manual deploy from an infected commit would have **failed**, not shipped.

**Before 2026-09-01, it would have shipped.** The guard was added by `1997992` on
09-01. The three earlier windows — 08-22, 08-27, 08-31 — predate it. Any deploy in
those windows built and published a poisoned bundle.

**OPEN, and the most important question here.** `Backend/server.js:254` exposes a
second deploy path:

```js
app.post('/api/deploy', ...)   // → exec('cd ~ && ./deploy.sh')
```

**Checked on the server, 2026-09-16: `~/deploy.sh` does not exist.** pm2 runs as
root, so the webhook's `cd ~ && ./deploy.sh` points at `/root/deploy.sh`, which is
missing. As the box stands today, that path cannot build anything, poisoned or not.

What this does NOT prove: that the file never existed. If it was present during one
of the windows above and has since been removed, it could still have shipped a
poisoned bundle. Deploy logs or shell history for those dates are the only way to
close that. It is also worth deciding whether `/api/deploy` should exist at all --
an unauthenticated-by-default route that execs a shell script is a standing risk,
and today it does nothing useful.

The local `Frontend/dist/` is clean, but it was built 2026-08-27 17:57, inside one
clean window. It says nothing about what the server built.

---

## Where it is NOT coming from

Checked and ruled out:

- no git hooks; `core.hooksPath` unset
- neither `package.json` declares install hooks
- the marker `A8-3388-2` appears nowhere in `node_modules`
- the only install hooks among installed packages belong to `esbuild`, `core-js`,
  `@firebase/util` and `protobufjs`

So something **outside the repository** writes that file: an editor extension, a
compromised global npm package, or another process on the developer machine. A
file inside this project cannot determine which.

One related detail already recorded in `check-source-integrity.mjs`: the same
payload was once committed to the seller app disguised as
`public/fonts/fa-solid-500.woff2` — an asset name that is not an asset — with an
editor task added to run it. **An editor task** is a strong hint about the vector.

---

## What has been done

| | |
|---|---|
| `Frontend/scripts/check-source-integrity.mjs` | pre-existing, wired into `npm run build`, catches it reliably |
| `.githooks/pre-commit` | **new** — runs the same check at commit time, which is where the payload actually entered. Not enabled automatically: `git config core.hooksPath .githooks` |

The guard was never the weak point. Its **timing** was: it ran at build, and none
of the seven authors above were building the frontend.

---

## What still needs a person

1. **Read `~/deploy.sh` on the server.** It decides whether the webhook path is
   guarded. This is the open question that determines whether a poisoned bundle
   reached users.
2. **Rotate every credential that machine can read**, `Backend/.env` included —
   Mongo URI, Razorpay keys, Firebase service account, JWT secrets. The payload
   executed with the developer's privileges at least seven times.
3. **Audit editor extensions and global npm packages** (`npm ls -g --depth=0`).
   The weekly-ish cadence with no in-repo vector fits an extension that
   self-updates.
4. **Check deploy history against the three pre-09-01 windows.** If a deploy
   happened in one, the bundle users received contained the payload.
5. **Enable the hook on every clone**, and consider a CI job that runs the
   integrity check on pull requests, so a poisoned commit cannot reach `main` even
   from a machine where the hook is not enabled.
