# QuickNotes Data Model

The database stores users, their notes, and the tags they use to organise notes. The SQL below is written for **PostgreSQL**.

## Entities and columns

### `users`

| Column | Type | Key | Notes |
|--------|------|-----|-------|
| `id` | `BIGINT` | **Primary key** | Generated automatically |
| `email` | `VARCHAR(255)` | Unique | Used to log in |
| `display_name` | `VARCHAR(100)` | | Shown in the app |
| `password_hash` | `VARCHAR(255)` | | Never the plain password |
| `created_at` | `TIMESTAMPTZ` | | Defaults to now |

### `notes`

| Column | Type | Key | Notes |
|--------|------|-----|-------|
| `id` | `BIGINT` | **Primary key** | Generated automatically |
| `user_id` | `BIGINT` | **Foreign key** → `users(id)` | The owner of the note |
| `title` | `VARCHAR(100)` | | Required, matches the 100-character rule in the API |
| `body` | `TEXT` | | Optional, empty string by default |
| `created_at` | `TIMESTAMPTZ` | | Defaults to now |
| `updated_at` | `TIMESTAMPTZ` | | Changed on every edit |

### `tags`

| Column | Type | Key | Notes |
|--------|------|-----|-------|
| `id` | `BIGINT` | **Primary key** | Generated automatically |
| `user_id` | `BIGINT` | **Foreign key** → `users(id)` | Tags belong to one user, so two users can both have a tag called "work" |
| `name` | `VARCHAR(50)` | Unique together with `user_id` | A user cannot have two tags with the same name |

### `note_tags` (join table)

| Column | Type | Key | Notes |
|--------|------|-----|-------|
| `note_id` | `BIGINT` | **Primary key (part 1)**, **foreign key** → `notes(id)` | |
| `tag_id` | `BIGINT` | **Primary key (part 2)**, **foreign key** → `tags(id)` | |

The primary key is the pair `(note_id, tag_id)`, which also stops the same tag being attached to the same note twice.

## Relationships

```
users 1 ───────< notes
users 1 ───────< tags
notes >───────< tags      (through note_tags)
```

- **One-to-many, users → notes:** one user owns many notes, and each note has exactly one owner. This is stored with the foreign key `notes.user_id`.
- **One-to-many, users → tags:** one user creates many tags, and each tag belongs to one user (`tags.user_id`).
- **Many-to-many, notes ↔ tags:** one note can have many tags ("work", "urgent") and one tag can be on many notes. A relational database cannot store this with a single column, so the join table `note_tags` holds one row per (note, tag) pair.
- **Deletes cascade:** deleting a user deletes their notes and tags; deleting a note or a tag deletes the matching `note_tags` rows. No orphan rows are left behind.
- The rule that a note and its tags must belong to the same user is checked by the application (and could be enforced with a composite foreign key later).

## CREATE TABLE statements

```sql
CREATE TABLE users (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email         VARCHAR(255) NOT NULL UNIQUE,
    display_name  VARCHAR(100) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE notes (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id    BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    title      VARCHAR(100) NOT NULL CHECK (char_length(trim(title)) > 0),
    body       TEXT        NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tags (
    id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name    VARCHAR(50) NOT NULL,
    UNIQUE (user_id, name)
);

CREATE TABLE note_tags (
    note_id BIGINT NOT NULL REFERENCES notes (id) ON DELETE CASCADE,
    tag_id  BIGINT NOT NULL REFERENCES tags (id)  ON DELETE CASCADE,
    PRIMARY KEY (note_id, tag_id)
);
```

## Indexes

```sql
-- Speeds up "show my newest notes" (GET /notes).
CREATE INDEX idx_notes_user_created
    ON notes (user_id, created_at DESC);

-- Speeds up "which notes have this tag?" (the primary key only helps the other direction).
CREATE INDEX idx_note_tags_tag_id
    ON note_tags (tag_id);
```

**Why these indexes:**

- `idx_notes_user_created`: almost every request is "give me this user's notes, newest first". With the index, the database jumps straight to one user's rows already in date order instead of scanning the whole `notes` table (about 73 million rows after a year, see `architecture.md`) and sorting them.
- `idx_note_tags_tag_id`: the primary key `(note_id, tag_id)` makes "tags of a note" fast, but filtering by tag starts from `tag_id`, which needs its own index.
- The `UNIQUE` constraints on `users.email` and `tags (user_id, name)` also create indexes, so login and tag lookup are already fast.
- **Cost:** every index uses disk space and makes inserts slightly slower, so only indexes that match real queries are added.

## Example queries

**1. List a user's newest notes (one page of 20)**

```sql
SELECT id, title, body, created_at
FROM notes
WHERE user_id = 7
ORDER BY created_at DESC
LIMIT 20 OFFSET 0;
```

**2. Find a user's notes that have the tag "work" (JOIN across three tables)**

```sql
SELECT n.id, n.title, n.created_at
FROM notes AS n
JOIN note_tags AS nt ON nt.note_id = n.id
JOIN tags AS t       ON t.id = nt.tag_id
WHERE n.user_id = 7
  AND t.name = 'work'
ORDER BY n.created_at DESC;
```

**3. Count how many notes each of a user's tags has (LEFT JOIN with GROUP BY)**

```sql
SELECT t.name, COUNT(nt.note_id) AS note_count
FROM tags AS t
LEFT JOIN note_tags AS nt ON nt.tag_id = t.id
WHERE t.user_id = 7
GROUP BY t.id, t.name
ORDER BY note_count DESC;
```

**4. Create a note and attach a tag (one transaction, so both succeed or neither does)**

```sql
BEGIN;

INSERT INTO notes (user_id, title, body)
VALUES (7, 'Plan sprint review', 'Invite the design team.')
RETURNING id;                                   -- suppose this returns 4821

INSERT INTO tags (user_id, name)
VALUES (7, 'work')
ON CONFLICT (user_id, name) DO NOTHING;

INSERT INTO note_tags (note_id, tag_id)
SELECT 4821, id FROM tags WHERE user_id = 7 AND name = 'work';

COMMIT;
```

**5. Delete a note (its `note_tags` rows are removed automatically)**

```sql
DELETE FROM notes
WHERE id = 4821 AND user_id = 7;
```

## SQL or NoSQL?

**Decision: SQL (PostgreSQL).**

The data is clearly structured and linked: users own notes, and notes and tags are in a many-to-many relationship. A relational database handles this naturally, with joins for "notes with this tag", foreign keys that stop orphan rows, and transactions that make "create a note and its tags" all-or-nothing. A user's notes are private and must never be lost or half-saved, so strong consistency matters more than raw write speed.

The load is also well within what one PostgreSQL primary and a read replica can handle (about 5 writes per second on average and a few hundred reads per second at peak). A document database such as MongoDB would store a note and its tags together nicely, but it makes cross-document questions like "all notes with this tag" or "tag usage counts" harder, and gives weaker guarantees about integrity. If QuickNotes ever outgrows a single primary, the data splits naturally by `user_id`, so the table can be sharded by user later without changing the model.
