"use strict";

/*
 * QuickNotes API client
 *
 * This page talks to the JSONPlaceholder practice API. JSONPlaceholder
 * "posts" stand in for QuickNotes "notes". The real QuickNotes API that the
 * backend team will build is described in docs/api-design.md.
 *
 * Rule used everywhere in this file: text that comes from the server or from
 * the user is only ever inserted into the page with textContent, so the
 * browser treats it as plain text and never as HTML markup.
 */

const API_URL = "https://jsonplaceholder.typicode.com/posts";
const NOTES_LIMIT = 10;

// ---------------------------------------------------------------- DOM
const loadBtn = document.getElementById("load-btn");
const statusEl = document.getElementById("status");
const notesList = document.getElementById("notes-list");
const noteForm = document.getElementById("note-form");
const titleInput = document.getElementById("title-input");
const bodyInput = document.getElementById("body-input");
const submitBtn = document.getElementById("submit-btn");

const MAX_TITLE_LENGTH = 100;
const CURRENT_USER_ID = 1;

// True while any request is running. Used to block double clicks.
let busy = false;

// ---------------------------------------------------------------- Requests

/**
 * One reusable wrapper around fetch().
 * - Calls fetch with the given URL and options.
 * - Checks response.ok and throws an Error (with a .status property) when the
 *   server answers with a 4xx or 5xx status. fetch() itself only rejects on
 *   network failures, so this check is essential.
 * - Returns { status, data } where data is the parsed JSON (or null when the
 *   response has no body).
 */
async function request(url, options = {}) {
  const response = await fetch(url, options);

  if (!response.ok) {
    const error = new Error(`Request failed with status ${response.status}`);
    error.status = response.status;
    throw error;
  }

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  return { status: response.status, data };
}

// GET: load the first 10 notes.
function getNotes() {
  return request(`${API_URL}?_limit=${NOTES_LIMIT}`);
}
// POST: create a note. JSONPlaceholder answers with status 201 and the
// note we sent plus a new id (always 101).
function createNote(note) {
  return request(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify(note),
  });
}
// DELETE: remove a note by id.
function deleteNote(id) {
  return request(`${API_URL}/${id}`, { method: "DELETE" });
}

// ---------------------------------------------------------------- UI helpers

// type is "loading", "success" or "error"; the CSS styles each one differently.
function showStatus(message, type) {
  statusEl.textContent = message;
  statusEl.className = `status status-${type}`;
}

// Disable the buttons while a request is running, enable them afterwards.
function setBusy(isBusy) {
  busy = isBusy;
  loadBtn.disabled = isBusy;
  submitBtn.disabled = isBusy;
  notesList.querySelectorAll(".delete-btn").forEach((button) => {
    button.disabled = isBusy;
  });
}

// Turn a technical error into a message a normal person can understand.
function friendlyError(error) {
  if (error && typeof error.status === "number") {
    return `The server could not complete the request (status ${error.status}). Please try again in a moment.`;
  }
  return "Could not reach the server. Please check your internet connection and try again.";
}

function removeEmptyState() {
  const empty = notesList.querySelector(".empty-state");
  if (empty) {
    empty.remove();
  }
}

// Empty state: shown inside the list when there are no notes.
function showEmptyState() {
  const li = document.createElement("li");
  li.className = "empty-state";
  li.textContent = "No notes to show.";
  notesList.appendChild(li);
}

function createNoteItem(note, isLocal = false) {
  const li = document.createElement("li");
  li.className = "note";
  if (isLocal) {
    // Created in this page only; see the comment above handleDelete.
    li.dataset.local = "true";
  }

  const title = document.createElement("h3");
  title.textContent = note.title;

  const body = document.createElement("p");
  body.textContent = note.body || "";

  li.append(title, body);
  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "delete-btn";
  deleteBtn.textContent = "Delete";
  deleteBtn.disabled = busy;
  // The click handler keeps a reference to this exact <li>. We cannot look
  // the note up by id, because every note created here gets the same id (101).
  deleteBtn.addEventListener("click", () => handleDelete(note, li));
  li.appendChild(deleteBtn);
  return li;
}

function renderNotes(notes) {
  notesList.replaceChildren();

  if (notes.length === 0) {
    showEmptyState();
    return;
  }

  notes.forEach((note) => {
    notesList.appendChild(createNoteItem(note));
  });
}
// Returns an error message, or null when the title is valid.
// A title is required and may have at most 100 characters.
// (The body is optional, so it is not validated.)
function validateTitle(title) {
  if (title.length === 0) {
    return "Please enter a title for your note.";
  }
  if (title.length > MAX_TITLE_LENGTH) {
    return `The title is too long (${title.length} characters). Please use ${MAX_TITLE_LENGTH} characters or fewer.`;
  }
  return null;
}

// ---------------------------------------------------------------- Handlers

async function handleLoad() {
  if (busy) {
    return;
  }

  setBusy(true);
  showStatus("Loading notes...", "loading");

  try {
    const { data } = await getNotes();
    renderNotes(data);

    if (data.length === 0) {
      showStatus("The server returned no notes.", "success");
    } else {
      showStatus(`Loaded ${data.length} notes from the server.`, "success");
    }
  } catch (error) {
    console.error(error);
    showStatus(friendlyError(error), "error");
  } finally {
    setBusy(false);
  }
}
async function handleSubmit(event) {
  event.preventDefault();

  if (busy) {
    return;
  }

  const title = titleInput.value.trim();
  const body = bodyInput.value.trim();

  const problem = validateTitle(title);
  if (problem) {
    showStatus(problem, "error");
    titleInput.focus();
    return;
  }

  setBusy(true);
  showStatus("Saving note...", "loading");

  try {
    const { status, data } = await createNote({
      title,
      body,
      userId: CURRENT_USER_ID,
    });

    removeEmptyState();
    notesList.prepend(createNoteItem(data, true));
    noteForm.reset();
    showStatus(`Note created (status ${status}, id ${data.id}).`, "success");
  } catch (error) {
    console.error(error);
    // The form is not cleared on failure, so the user can try again.
    showStatus(friendlyError(error), "error");
  } finally {
    setBusy(false);
  }
}
// Remove a note from the page and show the empty state if it was the last one.
function removeNoteFromList(li) {
  li.remove();
  if (!notesList.querySelector(".note")) {
    showEmptyState();
  }
}

/*
 * About DELETE and JSONPlaceholder
 *
 * JSONPlaceholder is a fake API: it accepts POST requests and replies as if
 * the note was saved, but it never stores anything. So:
 *  - Notes loaded with GET are "real" server notes. DELETE /posts/{id}
 *    succeeds (status 200) and we remove the note from the list.
 *  - Notes created with POST do not exist on the server. Their id (101) is
 *    the same every time, so the server may reply 404 Not Found. A note
 *    that exists only in this page cannot be missing from the server in any
 *    way that matters, so for these notes (marked data-local="true") a 404
 *    is treated as success and the note is removed from the list.
 * We still send the DELETE request for local notes. This keeps the code path
 * identical to a real API, where the same call would delete a stored note.
 * Any other error (network failure, 500, ...) keeps the note in the list and
 * shows an error message.
 */
async function handleDelete(note, li) {
  if (busy) {
    return;
  }

  const isLocal = li.dataset.local === "true";

  setBusy(true);
  showStatus(`Deleting note ${note.id}...`, "loading");

  try {
    const { status } = await deleteNote(note.id);
    removeNoteFromList(li);
    showStatus(`Note deleted (status ${status}, id ${note.id}).`, "success");
  } catch (error) {
    if (isLocal && error.status === 404) {
      removeNoteFromList(li);
      showStatus(
        "Note removed. It only existed in this page, so the server had nothing to delete.",
        "success"
      );
    } else {
      console.error(error);
      showStatus(friendlyError(error), "error");
    }
  } finally {
    setBusy(false);
  }
}

// ---------------------------------------------------------------- Wiring
loadBtn.addEventListener("click", handleLoad);
noteForm.addEventListener("submit", handleSubmit);
