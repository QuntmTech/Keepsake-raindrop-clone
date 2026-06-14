# PocketBase schema

Only needed when you switch Settings → Storage to **PocketBase**. The default local backend
needs no server. Create these three collections in your PocketBase admin (Settings → Collections),
**plus** the built-in `users` auth collection (already exists).

> Set API rules so users only see their own rows (see "API rules" at the bottom).

---

## 1. `collections` (type: Base)
| Field | Type | Notes |
|---|---|---|
| name | Text | required |
| color | Text | optional (hex) |
| icon | Text | optional (emoji) |
| parent | Relation → collections | optional, single, for nesting |
| sort | Number | optional, manual ordering |
| user | Relation → users | required, single |

## 2. `bookmarks` (type: Base)
| Field | Type | Notes |
|---|---|---|
| url | URL | required |
| title | Text | required |
| description | Text | optional |
| summary | Text | optional (AI TL;DR) |
| note | Text | optional (user note) |
| tags | JSON | array of strings, e.g. `["dev","ai"]` |
| aiTags | JSON | array of strings (AI-suggested) |
| collection | Relation → collections | optional, single |
| domain | Text | optional |
| type | Select | article, video, image, pdf, repo, doc, link |
| favorite | Bool | optional |
| readingTime | Number | optional (minutes) |
| cover | Text | optional (remote og:image URL) |
| favicon | Text | optional (URL) |
| screenshot | File | optional, single image (auto preview) |
| lastVisited | Date | optional |
| user | Relation → users | required, single |

## 3. `highlights` (type: Base)
| Field | Type | Notes |
|---|---|---|
| url | URL | required |
| text | Text | required (the highlighted text) |
| note | Text | optional annotation |
| color | Select | yellow, green, blue, pink, orange |
| anchor | Text | optional serialized TextQuoteAnchor (quote + prefix/suffix) |
| bookmark | Relation → bookmarks | optional, single |
| user | Relation → users | required, single |

---

## API rules (per collection — paste into each rule box)

For `bookmarks`, `collections`, and `highlights`, set **all five** rules to:

```
@request.auth.id != "" && user = @request.auth.id
```

Must be logged in, and can only touch your own rows. For the `users` collection, leave the
default auth rules (allow login / signup as you prefer).

> The client sends `user = <own id>` on create; the rule above is the real guard.
