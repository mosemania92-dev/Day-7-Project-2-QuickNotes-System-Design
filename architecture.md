# QuickNotes Architecture

QuickNotes is moving from a browser-only app (notes stored on one device) to an online service where notes are stored on servers and available on every device. This document describes the system we will build for **1 million registered users**.

## 1. Requirements

### Functional requirements

- Users can register, log in and log out.
- Users can create, read, update and delete their own notes (title up to 100 characters, optional body).
- Users can organise notes with tags and filter the list by tag.
- Users can search their notes by text.
- Notes created on one device appear on all the user's other devices.
- Users can only ever see their own notes.

### Non-functional requirements

| Requirement | Target |
|-------------|--------|
| **Availability** | 99.9% uptime (about 8.8 hours of downtime per year at most); no single component failure may take the service down |
| **Latency** | 95% of API requests answered in under 300 ms |
| **Durability** | A saved note is never lost: replicated database and daily backups |
| **Scalability** | Handles 1 million users today and can grow 10× by adding servers, not by rewriting |
| **Consistency** | A user sees their own change immediately ("read your own writes"); other devices may lag by a few seconds |
| **Security and privacy** | HTTPS everywhere, hashed passwords, per-user access checks |
| **Maintainability** | Stateless app servers, so they can be added, removed and redeployed freely |

## 2. Load estimate for 1 million users

### Assumptions

- Registered users: **1,000,000**
- Daily active users (DAU): **20%** = **200,000**
- Each active user makes **20 reads per day** (opening the app, refreshing the list, opening a note)
- Each active user makes **2 writes per day** (1 new note and 1 edit or delete)
- An average note is about **2 KB** (title, body and metadata); indexes and tag links add about 50% on top
- Peak traffic is **5×** the average
- 1 day = 86,400 seconds; units are decimal

### Reads per second

- Reads per day: 200,000 × 20 = 4,000,000
- Average: 4,000,000 / 86,400 ≈ **46 reads/s**
- Peak (5×): ≈ **231 reads/s**

### Writes per second

- Writes per day: 200,000 × 2 = 400,000
- Average: 400,000 / 86,400 ≈ **4.6 writes/s**
- Peak (5×): ≈ **23 writes/s**

### Storage per year

- New notes per year: 200,000 × 1 × 365 = **73,000,000 notes**
- Raw size: 73,000,000 × 2 KB = 146,000,000 KB ≈ **146 GB/year**
- With indexes and tag links (× 1.5): ≈ **220 GB/year**
- With one replica (× 2) the disks hold ≈ **440 GB/year**, plus backups

### What the numbers tell us

- The system is **read-heavy**: about 10 reads for every write.
- The raw load is small: one well-sized database primary could serve it. The components below are chosen mainly for **availability** (surviving failures) and **headroom** (growing 10× without a redesign), not because one server could not cope.

## 3. Architecture diagram

```
                              +----------------------+
                              |        Client        |
                              |   (browser / app)    |
                              +----------+-----------+
                                         |
                                1. look up the name
                                         v
                              +----------------------+
                              |         DNS          |
                              | api.quicknotes...    |
                              +----+------------+----+
                                   |            |
              static files         |            |   API calls (HTTPS)
        (HTML, CSS, JS, images)    v            v
                      +-------------------+  +--------------------------+
                      |        CDN        |  |      Load Balancer       |
                      | (edge caches near |  |  (active + standby pair) |
                      |  the users)       |  +------------+-------------+
                      +---------+---------+               |
                                | cache miss     +--------+--------+
                                v                |                 |
                      +-------------------+      v                 v
                      |   Static files    |  +--------------+ +--------------+
                      |  (object storage) |  | App Server 1 | | App Server 2 |  ... N
                      +-------------------+  |  (stateless) | |  (stateless) |
                                             +------+-------+ +-------+------+
                                                    |                 |
                         +--------------------------+--------+--------+---------+
                         |                          |                          |
                         v                          v                          v
                  +--------------+        +------------------+        +----------------+
                  |    Cache     |        |   Primary DB     |        |     Queue      |
                  |   (Redis)    |        |    (writes)      |        |   (jobs)       |
                  +--------------+        +--------+---------+        +-------+--------+
                                                   |                          |
                                       replication |                          | take a job
                                                   v                          v
                                          +------------------+        +----------------+
                                          |   Read Replica   |        |     Worker     |
                                          |     (reads)      |        | (search index, |
                                          +------------------+        |  emails, ...)  |
                                                                      +----------------+
```

## 4. Components: the problem each one solves

- **Client:** gives users a place to read and write notes, and keeps a local copy of what it has shown so the screen feels fast.
- **DNS:** solves the problem of users having to know server IP addresses by turning `api.quicknotes.example` into the address of the CDN or load balancer, and lets us move or add servers without changing the name.
- **CDN:** solves slow page loads and wasted server work by serving static files (HTML, CSS, JavaScript, images) from edge caches close to the user instead of from our servers.
- **Load balancer:** solves the single-server bottleneck and single point of failure by spreading requests across several app servers and sending traffic only to healthy ones.
- **App servers (two or more):** solve the need to run the business logic (login, validation, ownership checks, building responses) in a way that scales, because they keep no state and more of them can simply be added.
- **Cache (Redis):** solves repeated slow database reads by keeping hot data, such as a user's first page of notes, in memory.
- **Primary database:** solves the need for a single, consistent, durable source of truth for users, notes and tags, and accepts all writes.
- **Read replica:** solves the read-heavy load on the primary by serving read queries from a continuously updated copy, and doubles as a standby that can take over if the primary fails.
- **Queue:** solves slow requests and traffic spikes by letting an app server hand off non-urgent work (search indexing, emails, exports) and answer the user immediately.
- **Worker:** solves the problem of doing that background work without slowing the API, by taking jobs from the queue at its own pace and retrying the ones that fail.

## 5. Request flows

### `GET /notes` (list my notes)

1. The client resolves `api.quicknotes.example` through **DNS** and opens an HTTPS connection to the **load balancer**.
2. The load balancer picks a healthy **app server** and forwards the request.
3. The app server checks the access token and finds the user id (for example 7). If the token is invalid it stops and returns `401`.
4. The app server builds the cache key `notes:7:page1` and asks the **cache**.
5. **Cache hit:** the cached JSON is returned straight away with status `200`. Go to step 9.
6. **Cache miss:** the app server runs the list query on the **read replica**: `SELECT ... FROM notes WHERE user_id = 7 ORDER BY created_at DESC LIMIT 20`.
7. The app server adds each note's tags (one extra query for the whole page, not one per note).
8. The app server stores the result in the cache with a **60-second expiry** so the next request is fast and stale data cannot live long.
9. The app server returns `200 OK` with the JSON list, and the response travels back through the load balancer to the client.

### `POST /notes` (create a note)

1. The client sends `POST /notes` with the JSON body; DNS and the **load balancer** route it to an **app server** exactly as above.
2. The app server checks the token (`401` if invalid) and **validates the body**: the title is required and at most 100 characters. If not, it returns `400` with an error body.
3. The app server opens a transaction on the **primary database** and inserts the note (and its tags) with the user id taken from the token.
4. The transaction commits. The note is now saved, and the primary starts replicating the change to the **read replica**.
5. The app server **deletes the user's cached list** (`notes:7:*`) so the next `GET /notes` does not show stale data.
6. The app server puts a job such as `{"type": "index_note", "note_id": 4821}` on the **queue**. Only the job id is stored, so the message is tiny.
7. The app server returns `201 Created` with the new note and a `Location` header. The user does not wait for step 8.
8. Later, a **worker** takes the job from the queue, updates the search index, and acknowledges the job. If the worker crashes, the job is not acknowledged and is delivered again, so the work is never silently lost.

**Reading your own write:** replication takes a moment, so a replica can briefly miss a note that was just saved. For a few seconds after a write, that user's reads are sent to the primary instead, so they always see what they just created.

## 6. Trade-offs

1. **Caching: speed versus freshness.** The cache makes list requests fast and protects the database, but cached data can be out of date. We reduce this by deleting the user's cache entry on every write and using a short 60-second expiry. A longer expiry would cut database load further but show old data for longer.
2. **Read replica: scale versus consistency.** Replicas let us scale reads and give us a standby database, but replication has a small delay, so a replica can be slightly behind the primary. The price is that the system is eventually consistent for other devices and needs the "read from the primary just after a write" rule above.
3. **Queue and worker: responsiveness versus complexity.** Moving indexing and emails to a background worker keeps `POST /notes` fast and absorbs spikes, but it adds two more systems to run and monitor, and means a new note may not be searchable for a few seconds. Doing the work inside the request would be simpler but slower and less reliable.
4. **SQL (PostgreSQL): integrity versus horizontal scaling.** A relational database gives joins, transactions and strong integrity, but writes still go to one primary, which is harder to scale than a NoSQL store. At about 23 writes per second at peak this is not a problem; if it becomes one, the data can be split (sharded) by `user_id`.
5. **More components: resilience versus operating cost.** Every extra piece (CDN, cache, queue, replica) removes a weakness but must be paid for, monitored and kept secure. For 1 million users we accept this because the availability target does not allow one failure to stop the service.

## 7. Avoiding single points of failure

A single point of failure is any component whose failure stops the whole service. Each component has a backup or a fallback:

| Component | How a single point of failure is avoided |
|-----------|------------------------------------------|
| **DNS** | Use a managed DNS service that runs on many servers worldwide, with short record lifetimes so traffic can be redirected quickly |
| **CDN** | A CDN has many edge locations by design; if one fails, users are served from another. The origin files are in replicated object storage |
| **Load balancer** | An active and a standby load balancer (or a managed service spread over several data centres) with a shared address; the standby takes over automatically |
| **App servers** | Two or more identical, stateless servers placed in different availability zones; the load balancer stops sending traffic to a failed one and the rest carry the load |
| **Cache** | A cache cluster with a replica. If the cache is lost, the app servers simply read from the database (slower, but still correct), so the cache is never required for correctness |
| **Primary database** | Continuous replication to the read replica in another zone, with automatic failover that promotes the replica to primary; daily backups and point-in-time recovery protect against data corruption |
| **Read replica** | If it fails, reads fall back to the primary until a new replica is created |
| **Queue** | A replicated or managed queue that stores messages on several nodes; jobs are acknowledged only after they finish, so they survive worker crashes |
| **Worker** | Several worker instances take jobs from the same queue; if one dies, the others continue and the unfinished job is redelivered |

Two further practices complete the design: **health checks** that detect failed components within seconds, and **monitoring and alerts** so the team is told before users notice. Failover is also **tested regularly**, because a backup that has never been tried may not work when it is needed.
