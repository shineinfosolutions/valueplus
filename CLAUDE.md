# Notes for AI assistants (Claude and others)

Read **README.md** first (stack, layout, deploy, D1 migration status), then the relevant sections of **memory.md** (the developer log) and, for database work, **docs/D1_MIGRATION_PLAN.md**.

## Working rules from the owner

1. **Change only what was asked.** Don't extend a request into related behaviour. For example:
   - "hide MRP for salesmen" meant only the display, not the price calculator;
   - "the shop closes at 10 PM" did not mean changing the 10:00–21:00 staff shift.

   If something related looks wrong, say so in one line and leave it alone.
2. **No staging.** Deploys go straight to production (`npx opennextjs-cloudflare build` then `npx opennextjs-cloudflare deploy --env=""`). Normally deploy **after 22:00 IST**, when the shop is closed. Deploy during shop hours only when the owner says so in the conversation.
3. **IST everywhere.** Use `lib/ist.ts`; never treat a UTC date as the business day.
4. **The machine clock may be wrong.** Get real IST from the live server instead:
   `node -e "fetch('https://valuplus.shineinfosolutions.in/login',{method:'HEAD'}).then(r=>{const d=new Date(r.headers.get('date'));console.log(new Date(d.getTime()+5.5*3600e3).toISOString())})"`
5. **The owner is non-technical and wants the work done end to end:**
   - tests, type check and build before every deploy;
   - smoke-test after the deploy;
   - report in plain language.
   - The owner often writes in Hinglish.
6. After a change, add it to **memory.md**: the relevant section plus a dated line in the Change Log.

## Before you deploy

- `npm test` passes: all test files, currently 28.
- `npx tsc --noEmit -p .` stays at or below **60 errors**. These are pre-existing; add none.
- Apply any new `d1/migrations/*.sql` to the remote D1 **before** deploying the code that uses it: `npx wrangler d1 migrations apply valueplus-db --remote`.
- After the deploy, check: `/login` 200, `/dashboard` 307, `/api/items` 401, `/realtime` 426 (all signed out).
- Rollback: `npx wrangler rollback --name valueplus-erp`.

## Database: the migration is live and partly automatic

- **MongoDB is still the source of truth.** Cloudflare D1 receives a copy of every write (write-through), and every registered read is compared against it (shadow).
- Two jobs in the 5-minute cron switch areas over by themselves, only at 22:00–00:25 IST:
  - `lib/d1/stage-c.ts` moves reads;
  - `lib/d1/stage-d.ts` moves writes.
- Check the live state before touching anything in `lib/d1/`, `lib/repo/` or a read/write path:
  `npx wrangler d1 execute valueplus-db --remote --json --command "SELECT key,value FROM feature_flags"`
- **Never connect to the live MongoDB from scripts or tests.** Tests use mongodb-memory-server and Miniflare D1.
- Read-only remote D1 queries are fine. Treat remote D1 writes (flags) as production changes: make them only when asked or when clearly part of the task, and record them in memory.md.
- Adding a read or write path in a migrated area: follow the "Rules for new code during the migration" in README.md §5. Reads that decide a write stay `mongoOnlyInD1`.
- Write paths still to build for Stage D: `lib/repo/WRITES_INVENTORY.md`. Item writes and everything money / stock-related move together as unit U5, last.

## Git

- Work on `main` unless told otherwise. Commit messages end with a `Co-Authored-By:` trailer.
- Pushing to `shineinfosolutions/valueplus` needs credentials with access. If a push fails with 403, tell the owner; don't try to work around it.
