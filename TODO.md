# Tom's Bill Bot - Feature Roadmap

## P0: Quick wins (small scope, high value)

- [ ] **Timezone support** — Allow users to set IANA timezone in `/settings`, display all timestamps in local time. Store in customer metadata.
- [ ] **`/history` command** — Unified activity timeline (sessions + invoices + payments) in one view, sorted by time desc. Group command.

## P1: Core workflow improvements

- [ ] **Project/tag support** — Tag work sessions: `/work #projectA`, `/work 2 #projectA`. Filter `/stats` and `/invoice` by project. New column `tag` on `work_sessions`.
- [ ] **Break/pause support** — `/break` and `/resume` commands to pause/resume active sessions. Track break time, deduct from billable hours. Needs a `breaks` table or break tracking on `work_sessions`.
- [ ] **Expense tracking** — `/expense 50 domain renewal` to log non-time expenses. Show as separate line items on invoices. New `expenses` table.

## P2: Team & reporting

- [ ] **`/team` command** — Group admin dashboard: who's working now, hours per member this week, outstanding invoices per member. Group command.
- [ ] **Daily/weekly work summary** — Opt-in auto-report via DM. "This week: 23.5 hrs across 3 groups, unbilled: 8 hrs ($400)." Extend cron trigger + user preference in metadata.

## P3: Polish

- [ ] **i18n / Localization** — Multi-language support (zh, ja, es, etc.). Detect from Telegram `language_code` or manual override in `/settings`. Externalize all bot strings.

## Out of scope (for now)

- Multi-currency (USDT only, current behavior is fine)
- Invoice PDF generation
- Client management / approval flow
- Payment system integration (Stripe, crypto deep-links)
- Multi-rate within a group
- Reporting & analytics / charts
