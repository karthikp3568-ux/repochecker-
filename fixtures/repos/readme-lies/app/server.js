const http = require("http");

const notes = new Map();
let nextId = 1;

function createNote(title, body) {
  const note = { id: nextId++, title, body, updatedAt: Date.now() };
  notes.set(note.id, note);
  return note;
}

function editNote(id, body) {
  const note = notes.get(id);
  if (!note) throw new Error("not found");
  note.body = body;
  note.updatedAt = Date.now();
  return note;
}

function searchNotes(query) {
  const q = query.toLowerCase();
  return [...notes.values()].filter((n) => n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q));
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/search") {
      res.end(JSON.stringify(searchNotes(url.searchParams.get("q") ?? "")));
      return;
    }
    res.end(JSON.stringify([...notes.values()]));
  })
  .listen(3000);

module.exports = { createNote, editNote, searchNotes };
