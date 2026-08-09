# Euphoria Auction — Supabase Edition

This project keeps the Euphoria layout and makes the auction state database-backed with Supabase.

## 1. Supabase
Create a Supabase project. In **SQL Editor**, paste and run `supabase/schema.sql`.

Create your admin account(s) under **Authentication → Users**. The app treats authenticated users as admins; do not create public user accounts.

## 2. Local / Vercel environment
Copy `.env.example` to `.env.local` and set:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Use the Supabase project's URL and anon/publishable key. Never put the service-role key in the browser.

## 3. Run
```bash
npm install
npm run dev
```

## 4. Deploy to Vercel
Import the GitHub repository as a Vite project. Add the same two environment variables in Vercel, then deploy.

## Notes
- Public users can view pools, live state, teams, bids, and results.
- Only authenticated Supabase users can call auction-changing RPCs.
- Bid increments are enforced in PostgreSQL.
- SOLD deducts the winning price atomically from that team's balance.
- Each of the 10 pools has an independent 150 EP balance for each of the five teams.
- The public view updates through Supabase Realtime.
