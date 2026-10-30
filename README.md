Webbuildr is an easy-to-use website-building platform designed for anyone who wants to create a clean, professional, or personal website without learning how to code.

## Run locally.

1. Install Node.js, then run `npm.cmd install` in this folder (in Windows PowerShell).
2. The local `.env.local` file contains this project's Supabase URL and publishable key. Keep it local; never add a secret/service-role key.
3. In the Supabase dashboard, open the **SQL Editor** and run `supabase-setup.sql`. If you already ran setup or see a `public.profiles` / `public.sites` schema-cache error, run `supabase-github-migration.sql`; it safely creates missing tables, updates GitHub profile creation, grants the required roles, backfills missing profiles, and asks the API to reload its schema.
4. In **Authentication → URL Configuration**, add `http://127.0.0.1:5173` to the allowed redirect URLs.
5. In **Authentication → Sign In / Providers → GitHub**, enable GitHub and enter the OAuth app’s Client ID and Client secret. In the GitHub OAuth app, set its callback URL to the Supabase callback URL shown by the provider settings.
6. Enable **Allow manual linking** in Supabase Auth settings if you want to connect GitHub from an existing email account. Repository browsing requests GitHub's broad `repo` OAuth scope so it can read private repositories; WebBuildr only reads repository contents and does not push changes.
7. Run `npm.cmd run dev` and open `http://127.0.0.1:5173`.

The browser app uses the Supabase publishable key, which is intended to be public. Never put a Supabase secret or service-role key in `.env.local` or browser code. Access to profiles and saved sites is restricted with row-level security.

The GitHub dashboard tab lists repositories, lets you browse text files, and copies their contents to your clipboard. It does not insert or execute repository code in a WebBuildr site. Private repository browsing requests GitHub's broad `repo` OAuth scope.

Sign-up uses Supabase Auth. If email confirmation is enabled in the Supabase project, new users must confirm their email before signing in. Accounts and sites previously stored only in browser local storage are not automatically migrated.
