# QuickNotes API Design

This document describes the **real QuickNotes API** that the backend team should build. The browser client in this repository uses the JSONPlaceholder practice API as a stand-in, so a few details differ (for example, the real API takes the user from the login token and the client does not send `userId`).

## Conventions

- **Base URL:** `https://api.quicknotes.example/v1` (the version is part of the path so the API can change without breaking old clients).
- **Format:** every request and response body is JSON (`Content-Type: application/json`).
- **Authentication:** `Authorization: Bearer <token>` on every endpoint except `POST /users` and `POST /auth/login`.
- **Ownership:** a user can only see and change their own notes and tags. The user is identified by the token, never by a field in the request body.
- **Resources are plural nouns** (`/notes`, `/tags`); the HTTP method says what to do with them.
- **Timestamps** are ISO 8601 in UTC (`2026-10-17T09:30:00Z`).
- **Validation rules:** `title` is required, 1 to 100 characters; `body` is optional, up to 10,000 characters; a tag name is 1 to 50 characters.
- **Pagination:** list endpoints accept `page` (default 1) and `limit` (default 20, maximum 100).

## Endpoints

| # | Method | Path | Description | Success status |
|---|--------|------|-------------|----------------|
| 1 | `POST` | `/users` | Register a new user account | `201 Created` |
| 2 | `POST` | `/auth/login` | Exchange email and password for an access token | `200 OK` |
| 3 | `GET` | `/notes` | List the current user's notes (supports `page`, `limit`, `tag`, `q`, `sort`) | `200 OK` |
| 4 | `POST` | `/notes` | Create a note | `201 Created` |
| 5 | `GET` | `/notes/{id}` | Get one note, including its tags | `200 OK` |
| 6 | `PUT` | `/notes/{id}` | Replace a note (title and body) | `200 OK` |
| 7 | `PATCH` | `/notes/{id}` | Change some fields of a note | `200 OK` |
| 8 | `DELETE` | `/notes/{id}` | Delete a note | `204 No Content` |
| 9 | `GET` | `/tags` | List the current user's tags | `200 OK` |
| 10 | `POST` | `/notes/{id}/tags` | Attach a tag to a note (the tag is created if it does not exist) | `201 Created` |
| 11 | `DELETE` | `/notes/{id}/tags/{tagId}` | Remove a tag from a note | `204 No Content` |

Notes on the design:

- `GET`, `PUT` and `DELETE` are **idempotent**: repeating the same call leaves the system in the same state. `POST` is not, so sending it twice creates two notes.
- `PUT` needs the full representation; `PATCH` accepts only the fields that change.
- `POST /notes` returns a `Location` header with the URL of the new note.
- `GET /notes?tag=work&q=meeting&sort=-created_at` filters by tag name, searches title and body, and sorts newest first.

## Example: create a note

**Request**

```http
POST /v1/notes HTTP/1.1
Host: api.quicknotes.example
Authorization: Bearer eyJhbGciOi...
Content-Type: application/json

{
  "title": "Plan sprint review",
  "body": "Invite the design team and prepare the demo.",
  "tags": ["work", "meetings"]
}
```

**Response: `201 Created`**

```http
HTTP/1.1 201 Created
Location: /v1/notes/4821
Content-Type: application/json

{
  "id": 4821,
  "title": "Plan sprint review",
  "body": "Invite the design team and prepare the demo.",
  "tags": [
    { "id": 12, "name": "work" },
    { "id": 31, "name": "meetings" }
  ],
  "created_at": "2026-10-17T09:30:00Z",
  "updated_at": "2026-10-17T09:30:00Z"
}
```

## Example: list notes

**Request**

```http
GET /v1/notes?page=1&limit=2&sort=-created_at HTTP/1.1
Host: api.quicknotes.example
Authorization: Bearer eyJhbGciOi...
```

**Response: `200 OK`**

```json
{
  "data": [
    {
      "id": 4821,
      "title": "Plan sprint review",
      "body": "Invite the design team and prepare the demo.",
      "tags": [
        { "id": 12, "name": "work" },
        { "id": 31, "name": "meetings" }
      ],
      "created_at": "2026-10-17T09:30:00Z",
      "updated_at": "2026-10-17T09:30:00Z"
    },
    {
      "id": 4790,
      "title": "Buy groceries",
      "body": "Milk, rice, tomatoes",
      "tags": [],
      "created_at": "2026-10-16T18:05:00Z",
      "updated_at": "2026-10-16T18:05:00Z"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 2,
    "total": 57
  }
}
```

## Error responses

Every error uses the same JSON envelope, so clients need only one error handler:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The title must be between 1 and 100 characters.",
    "details": [
      { "field": "title", "issue": "must be 100 characters or fewer" }
    ],
    "request_id": "req_7f3a9c21"
  }
}
```

`code` is a stable machine-readable string, `message` is for people, `details` is optional, and `request_id` lets support staff find the request in the logs.

| Status | Name | When the API returns it | Example `error.code` |
|--------|------|-------------------------|----------------------|
| `400` | Bad Request | Malformed JSON, missing or invalid field (for example an empty title or one longer than 100 characters) | `VALIDATION_ERROR` |
| `401` | Unauthorized | The token is missing, expired or invalid, or the login credentials are wrong | `UNAUTHENTICATED` |
| `403` | Forbidden | The user is logged in but not allowed to do this (for example a suspended account) | `FORBIDDEN` |
| `404` | Not Found | The note or tag does not exist, **or belongs to another user** (we answer 404, not 403, so the API does not reveal that the id exists) | `NOT_FOUND` |
| `409` | Conflict | The email is already registered, or the tag is already attached to the note | `CONFLICT` |
| `429` | Too Many Requests | The client exceeded its rate limit; a `Retry-After` header says when to retry | `RATE_LIMITED` |
| `500` | Internal Server Error | An unexpected bug or failure on the server | `INTERNAL_ERROR` |
| `503` | Service Unavailable | The service is overloaded or down for maintenance | `UNAVAILABLE` |

**Example `401` body**

```json
{
  "error": {
    "code": "UNAUTHENTICATED",
    "message": "Your session has expired. Please log in again.",
    "request_id": "req_2b81d0e4"
  }
}
```

**Example `404` body**

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Note 9999 was not found.",
    "request_id": "req_91c4aa07"
  }
}
```

**Example `500` body** (internal details are logged, never sent to the client)

```json
{
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "Something went wrong on our side. Please try again later.",
    "request_id": "req_c03e5d68"
  }
}
```
