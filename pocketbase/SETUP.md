# Set up cloud sync (PocketBase) — beginner guide

This gives Keepsake real accounts + bookmarks that sync to the cloud and **survive
every reload/reinstall**. No coding. ~10 minutes. You'll use **PocketHost**, which
runs a PocketBase server for you for free (so you don't host anything yourself).

---

## Step 1 — Create a free server on PocketHost
1. Go to **https://pockethost.io** and click **Sign up** (free).
2. Click **New instance**. Give it a name like `keepsake`.
3. Wait ~30 seconds until it says **Running**. Your server URL looks like:
   **`https://keepsake.pockethost.io`** — copy it, you'll need it twice.

## Step 2 — Open the admin panel & create the admin account
1. On your instance, click **Admin** (or go to `https://keepsake.pockethost.io/_/`).
2. The first time, it asks you to create an **admin** email + password. This is the
   *server owner* login (not your Keepsake user) — save it somewhere.

## Step 3 — Load the Keepsake collections (one click)
1. In the admin panel, left sidebar → **Settings** → **Import collections**.
2. Click **Load from JSON** and paste the contents of **`pb_schema.json`**
   (the file I sent you), or upload the file.
3. It shows it will create **collections**, **bookmarks**, **highlights**.
   Click **Review** → **Confirm/Import**.

> If the import errors out (PocketBase versions differ), use the **Manual** section
> at the bottom — it's just adding a few text fields, ~5 minutes.

## Step 4 — Allow signups (usually already on)
1. Left sidebar → **Collections** → **users** → the gear/settings icon →
   **Options/API rules**. Make sure **Create rule** is set so new users can sign up
   (an empty Create rule = anyone can sign up). Save.

## Step 5 — Connect Keepsake to your server
1. Open the Keepsake popup → **Settings** tab → **Storage**.
2. Choose **PocketBase server (cloud sync)**.
3. Paste your server URL (`https://keepsake.pockethost.io`) → **Connect & switch**.
4. Keepsake reloads. Now **Sign up** with any email + password — this creates your
   *cloud* account (separate from the old local one).

Done! Your bookmarks now live in the cloud. Reinstalling the extension, switching
computers, etc. won't lose anything — just sign in.

> Tip: before switching, you can **Export JSON** (Settings → Import & export) from
> your local account, then after signing into the cloud account, **Import** that
> file to bring your existing bookmarks over.

---

## Manual fallback (only if Step 3 import fails)
Create 3 collections (Collections → New collection → type **Base**). In each, add
these fields (everything is type **Plain text** unless noted), then set all 5 API
rules to: `@request.auth.id != "" && user = @request.auth.id`

**collections:** name, color, icon, parent, sort *(Number)*, user
**bookmarks:** url, title, description, summary, note, tags *(JSON)*, aiTags *(JSON)*,
collection, cover, favicon, screenshot *(File, single image)*, domain, type,
favorite *(Bool)*, readingTime *(Number)*, lastVisited *(Date)*, user
**highlights:** url, text, note, color, anchor, bookmark, user

(PocketBase adds `id`, `created`, `updated` automatically.)
