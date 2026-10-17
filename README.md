# QuickNotes System Design

QuickNotes is a notes app that is moving from a browser-only tool to an online service for 1 million users. This repository has two parts:

1. **An API client** (`index.html`, `api.js`, `style.css`) that proves the front end can talk to a REST API. It uses the free [JSONPlaceholder](https://jsonplaceholder.typicode.com) practice API, where "posts" stand in for notes.
2. **Three design documents** in the `docs/` folder that the backend team will build the real service from.

## How to run the API client

The client is plain HTML, CSS and JavaScript, so it needs no build step and no installation. It does need an internet connection, because it calls JSONPlaceholder.

**Option 1: open the file.** Download or clone the repository and double-click `index.html`.

**Option 2: run a small local server** (recommended):

```bash
git clone https://github.com/your-username/quicknotes-system-design.git
cd quicknotes-system-design
python3 -m http.server 8000
```

Then open <http://localhost:8000> in your browser. (In VS Code, the "Live Server" extension works too.)

**What you can do on the page**

| Action | What happens |
|--------|--------------|
| Click **Load notes** | Sends `GET /posts?_limit=10` and lists 10 notes, with a loading message first and a success or error message afterwards |
| Fill in the form and click **Add note** | Checks the title (required, at most 100 characters), then sends `POST /posts` and puts the new note at the top of the list |
| Click **Delete** on a note | Sends `DELETE /posts/{id}` and removes the note from the list |

JSONPlaceholder never really stores what you send, so notes you create disappear when you reload the page. `api.js` explains how deleting such notes is handled.

## Documents

- [API design](docs/api-design.md): the REST endpoints, JSON examples and error codes of the real QuickNotes API
- [Data model](docs/data-model.md): tables, keys, relationships, SQL, indexes and the SQL versus NoSQL decision
- [Architecture](docs/architecture.md): requirements, load estimates, the architecture diagram, request flows, trade-offs and single points of failure

## Project structure

```
quicknotes-system-design/
├── index.html
├── api.js
├── style.css
├── README.md
└── docs/
    ├── api-design.md
    ├── data-model.md
    └── architecture.md
```

## What I learned

1. **`fetch` does not fail on error statuses.** A 404 or 500 response still counts as a "successful" fetch, so the code must check `response.ok` and throw an error itself. Putting this in one reusable `request()` function means GET, POST and DELETE all handle errors the same way.
2. **A good interface shows every state.** Loading, success, error and empty are four different situations, and users need to see each one. Disabling the buttons while a request runs also prevents double submissions.
3. **User and server text must never be treated as HTML.** Using `textContent` instead of building HTML strings stops a note title such as `<img onerror=...>` from running code in the page.
4. **Fake APIs have limits.** JSONPlaceholder does not store the notes I create, so deleting them needed a deliberate design decision, and I explained it in a code comment.
5. **Design the data before the code.** Writing the data model showed me why a many-to-many relationship (notes and tags) needs a join table, and why indexes should match the queries the app really runs.
6. **Architecture is about trade-offs.** Doing the load estimate showed that 1 million users is a modest load. Caches, replicas and queues are there for availability and growth, and each one brings its own costs, such as stale data and more systems to run.
