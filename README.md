# WebBuildr

WebBuildr helps you make simple websites. You can start with a template, add page blocks, and save your work to your account.

## Run WebBuildr on your computer

### 1. Install the tools

Install [Node.js](https://nodejs.org/). Open PowerShell in the `WebBuildr` folder and install the project packages:

```powershell
npm.cmd install
```

### 2. Add your Supabase settings

Copy `.env.example` and name the copy `.env.local`. In PowerShell, you can do this with:

```powershell
Copy-Item .env.example .env.local
```

Add your Supabase project URL and publishable key to that file.

The publishable key is meant to be used in a browser. Never add a secret key or service-role key to `.env.local` or to the website code.

### 3. Set up the database

In your Supabase project, open **SQL Editor** and run `supabase-setup.sql`.

If you already ran the setup, or the app says it cannot find `public.profiles` or `public.sites`, run `supabase-github-migration.sql` instead. It creates missing tables, updates GitHub sign-in, and fixes the database's table list.

### 4. Set up sign-in

In Supabase, open **Authentication → URL Configuration**. Add this address to the allowed redirect URLs:

```text
http://127.0.0.1:5173
```

To let people sign in with GitHub:

1. Open **Authentication → Sign In / Providers → GitHub** and turn GitHub on.
2. Add your GitHub app's Client ID and Client secret.
3. In your GitHub app settings, use the callback address shown in the Supabase provider settings.
4. Turn on **Allow manual linking** in Supabase if people should be able to connect GitHub to an existing account.

GitHub sign-in is only used to authenticate your WebBuildr account; WebBuildr does not access your repositories.

### 5. Start the website

Run this command in PowerShell:

```powershell
npm.cmd run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173) in your browser.

### 6. Enable account deletion

The Settings page calls the `delete-acc` Edge Function when someone confirms account deletion. In PowerShell, go to the `WebBuildr` project folder and install the Supabase CLI as a project dependency:

```powershell
npm.cmd install --save-dev supabase
npx.cmd supabase login
npx.cmd supabase link --project-ref htygbtndxvpgcripgoej
npx.cmd supabase functions deploy delete-acc
```

If you use a different Supabase project, replace `htygbtndxvpgcripgoej` with that project's reference ID. The `npx.cmd` commands use the locally installed CLI and do not require a global `supabase` command.

The function validates the caller's access token and deletes only that signed-in user's account. It uses `SUPABASE_SERVICE_ROLE_KEY` on the server; never put a service-role key in `.env.local` or browser code. Supabase provides this secret to Edge Functions.

## Notes

- Supabase controls who can read and change saved profiles and websites.
- If email confirmation is turned on in Supabase, new users must confirm their email before signing in.
- Websites and accounts saved only in the browser are not copied to Supabase automatically.
