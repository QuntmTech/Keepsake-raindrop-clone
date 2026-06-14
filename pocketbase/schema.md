# PocketBase schema

Create these three collections in your PocketBase admin UI (Settings → Collections),
**plus** the built-in `users` auth collection (already exists).

> Tip: you can paste these as a starting point, but PocketBase's UI is the source of truth.
> Set API rules so users only see their own rows (see "API rules" at the bottom).

---

## 1. `collections` (type: Base)
| Field | Type | Notes |
|---|---|---|
| name | Text | required |
| color | Text | optional (hex) |
| icon | Text | optional |
| parent | Relation → collections | optional, single, for nesting |
| user | Relation → users | required, single |

## 2. `bookmarks` (type: Base)
| Field | Type | Notes |
|---|---|---|
| url | URL | required |
| title | Text | required |
| description | Text | optional |
| tags | JSON | array of strings, e.g. `["dev","ai"]` |
| collection | Relation → collections | optional, single |
| domain | Text | optional |
| cover | File | optional, single image |
| screenshot | File | optional, single image (auto preview) |
| user | Relation → users | required, single |

## 3. `highlights` (type: Base)
| Field | Type | Notes |
|---|---|---|
| url | URL | required |
| text | Text | required (the highlighted text) |
| note | Text | optional annotation |
| color | Select | yellow, green, blue, pink, orange |
| anchor | Text | optional serialized range (for robust re-anchoring later) |
| bookmark | Relation → bookmarks | optional, single |
| user | Relation → users | required, single |

---

## API rules (per collection — paste into each rule box)

For `bookmarks`, `collections`, and `highlights`, set **all five** rules to:

```
@request.auth.id != "" && user = @request.auth.id
```

This means: must be logged in, and can only touch your own rows. The `create` rule
additionally relies on the client sending `user = <own id>` (the lib does this).

For the `users` collection, leave default auth rules (allow login / signup as you prefer).
