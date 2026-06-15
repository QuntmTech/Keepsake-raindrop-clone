# Set up cloud sync (PocketBase)

Gives Keepsake real accounts + bookmarks that sync to the cloud and survive every
reload/reinstall. PocketBase is a single binary (DB + auth + file storage).

> **Must be served over HTTPS.** The extension runs in secure contexts, so a plain
> `http://` server will be blocked (especially the in-page Quick Bar). Use a domain
> + TLS as shown below.

---

## Option A — Self-host on your own VPS (recommended if you have one)

Assumes Ubuntu/Debian and a (sub)domain you can point at the VPS.

**1. DNS:** add an `A` record `pb.yourdomain.com → <your VPS IP>`. Open ports **80 + 443**.

**2. Install PocketBase:**
```bash
mkdir -p /opt/keepsake-pb && cd /opt/keepsake-pb
VER=$(curl -s https://api.github.com/repos/pocketbase/pocketbase/releases/latest | grep -oP '"tag_name": "v\K[^"]+')
ARCH=amd64   # use arm64 if your VPS is ARM
curl -L -o pb.zip "https://github.com/pocketbase/pocketbase/releases/download/v${VER}/pocketbase_${VER}_linux_${ARCH}.zip"
unzip pb.zip && rm pb.zip
```

**3a. Simplest — PocketBase's built-in auto-HTTPS** (nothing else on 80/443):
```bash
sudo ./pocketbase serve --https=pb.yourdomain.com   # gets a Let's Encrypt cert automatically
```

**3b. Already running nginx/Caddy on 80/443?** Run PB locally and reverse-proxy it:
```bash
./pocketbase serve --http=127.0.0.1:8090
```
Then proxy `https://pb.yourdomain.com` → `127.0.0.1:8090` (Caddy one-liner:
`pb.yourdomain.com { reverse_proxy 127.0.0.1:8090 }`).

**4. Keep it running (systemd):**
```bash
sudo tee /etc/systemd/system/keepsake-pb.service >/dev/null <<'UNIT'
[Unit]
Description=Keepsake PocketBase
After=network.target
[Service]
Type=simple
User=root
WorkingDirectory=/opt/keepsake-pb
ExecStart=/opt/keepsake-pb/pocketbase serve --https=pb.yourdomain.com
Restart=always
[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload && sudo systemctl enable --now keepsake-pb
```
(For 3b, change `ExecStart` to `... serve --http=127.0.0.1:8090`.)

Your server is now at **`https://pb.yourdomain.com`**.

---

## Option B — PocketHost (managed, only if you DON'T have a server)
Sign up at **pockethost.io** → New instance → use the URL it gives you. No VPS needed.

---

## Then, for either option:

**Create the admin + load the schema**
1. Open **`https://pb.yourdomain.com/_/`** → create the admin (server owner) account.
2. **Settings → Import collections → Load from JSON** → paste/upload **`pb_schema.json`**
   → Confirm. Creates `collections`, `bookmarks`, `highlights`.
3. **Collections → users → API rules:** make sure the **Create** rule allows signups
   (empty = anyone can sign up).

**Connect Keepsake**
1. Keepsake → **Settings → Storage → PocketBase server** → paste `https://pb.yourdomain.com`
   → **Connect & switch**.
2. **Sign up** with any email/password → that's your cloud account.

> Move existing bookmarks over: on your local account do **Export JSON** first, then after
> signing into the cloud account, **Import file** that JSON.

---

## Manual schema fallback (only if the JSON import fails)
Create 3 **Base** collections; add these fields (all **Plain text** unless noted); set all
5 API rules to `@request.auth.id != "" && user = @request.auth.id`:

- **collections:** name, color, icon, parent, sort *(Number)*, user
- **bookmarks:** url, title, description, summary, content, note, tags *(JSON)*, aiTags *(JSON)*,
  collection, cover, favicon, screenshot *(File, single image)*, domain, type,
  favorite *(Bool)*, readingTime *(Number)*, lastVisited *(Date)*, user
- **highlights:** url, text, note, color, anchor, bookmark, user

(`id`, `created`, `updated` are added automatically.)
