const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATABASE_PATH = process.env.DATABASE_PATH || path.join(ROOT, "blog.sqlite");
const MAX_BODY_BYTES = 1024 * 1024;
const SESSION_DAYS = 30;

const db = new DatabaseSync(DATABASE_PATH);
db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    author_name TEXT NOT NULL,
    title TEXT NOT NULL,
    excerpt TEXT NOT NULL,
    body TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'Notes',
    image_url TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    author_name TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS posts_created_at_idx ON posts(created_at DESC);
  CREATE INDEX IF NOT EXISTS comments_post_id_idx ON comments(post_id, created_at);
`);

const seedPosts = [
  {
    author: "Mara Ellis",
    title: "The case for taking the long way home",
    excerpt: "Somewhere between the shortcut and the scenic route, I found a little more room to think.",
    body: "Last Thursday I missed my usual bus on purpose. The next one was twelve minutes away, and instead of waiting I started walking.\n\nThe city was doing that early-evening thing: shop windows turning gold, a baker sweeping flour from the doorstep, somebody watering a balcony garden. None of it was remarkable. That was the remarkable part.\n\nWe have become very good at getting where we said we were going. I wonder what we might notice if, every now and then, we gave ourselves permission to arrive a little later.\n\nI eventually caught the bus three stops down. I got home in almost the same amount of time, but the day felt somehow longer—in the nicest way.",
    category: "Slow living",
    image: "photo-1441974231531-c6227db76b6e"
  },
  {
    author: "Jonah Reed",
    title: "A small guide to making room",
    excerpt: "On clearing a desk, a calendar, and the space between the things we say yes to.",
    body: "The desk was not particularly messy. One mug, two notebooks, a pair of headphones. Still, every morning I sat down and felt behind before I'd started.\n\nSo I took everything off and put back only what I needed for the next hour. Not the whole day. Not a plan for the week. Just the next hour.\n\nIt turns out a little space can be more useful than a perfect system. The same has been true of my calendar. Fewer promises, more attention to the ones I keep.\n\nThis is not a productivity trick. It is an invitation to notice what you are carrying—and whether you still need all of it.",
    category: "A gentler pace",
    image: "photo-1497366754035-f200968a6e72"
  },
  {
    author: "Nina Park",
    title: "Recipes from the in-between",
    excerpt: "A bright, unfussy lunch for the days when the seasons haven't quite made up their minds.",
    body: "There is a particular kind of afternoon in late spring when the sun is warm but the wind has other plans. This is a lunch for exactly that kind of day.\n\nToss a can of butter beans with lemon zest, a generous squeeze of juice, olive oil, and a pinch of flaky salt. Add whatever herbs survived the week in your fridge. Parsley is lovely; dill is even better.\n\nToast a thick slice of sourdough. Spoon the beans on top. Add cracked pepper and something crunchy if you have it—cucumber, radish, or last night's fennel.\n\nEat near a window. Take the rest of the afternoon as it comes.",
    category: "At the table",
    image: "photo-1490645935967-10de6ba17061"
  }
];

const postCount = db.prepare("SELECT COUNT(*) AS count FROM posts").get().count;
if (postCount === 0) {
  const insertPost = db.prepare(
    "INSERT INTO posts (author_name, title, excerpt, body, category, image_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  const insertComment = db.prepare(
    "INSERT INTO comments (post_id, author_name, body, created_at) VALUES (?, ?, ?, ?)"
  );
  for (const [index, post] of seedPosts.entries()) {
    const date = new Date(Date.now() - index * 86400000 * 2).toISOString();
    const result = insertPost.run(
      post.author, post.title, post.excerpt, post.body, post.category,
      `https://images.unsplash.com/${post.image}?auto=format&fit=crop&w=1200&q=85`,
      date
    );
    if (index === 0) {
      insertComment.run(result.lastInsertRowid, "Oliver Grant", "This is exactly the reminder I needed today.", new Date(Date.now() - 3600000).toISOString());
      insertComment.run(result.lastInsertRowid, "Nina Park", "The best things are rarely on the fastest route.", new Date(Date.now() - 1800000).toISOString());
    }
  }
}

function jsonResponse(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  res.end(JSON.stringify(data));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => {
      data += chunk;
      if (Buffer.byteLength(data) > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("Request body is too large."), { status: 413 }));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(Object.assign(new Error("Request body must be valid JSON."), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

function cleanText(value, field, maxLength, required = true) {
  if (typeof value !== "string") {
    if (!required && (value === undefined || value === null)) return "";
    throw Object.assign(new Error(`${field} must be text.`), { status: 400 });
  }
  const cleaned = value.trim();
  if (required && !cleaned) {
    throw Object.assign(new Error(`${field} is required.`), { status: 400 });
  }
  if (cleaned.length > maxLength) {
    throw Object.assign(new Error(`${field} must be ${maxLength} characters or fewer.`), { status: 400 });
  }
  return cleaned;
}

function authenticate(req) {
  const authorization = req.headers.authorization || "";
  const match = authorization.match(/^Bearer ([a-f0-9]{64})$/);
  if (!match) return null;
  const tokenHash = crypto.createHash("sha256").update(match[1]).digest("hex");
  return db.prepare(`
    SELECT users.id, users.name, users.email
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > datetime('now')
  `).get(tokenHash) || null;
}

function requireUser(req) {
  const user = authenticate(req);
  if (!user) throw Object.assign(new Error("Please sign in to continue."), { status: 401 });
  return user;
}

function postSelect() {
  return `
    SELECT posts.id, posts.user_id AS userId, posts.author_name AS author,
      posts.title, posts.excerpt, posts.body, posts.category,
      posts.image_url AS imageUrl, posts.created_at AS createdAt,
      posts.updated_at AS updatedAt, COUNT(comments.id) AS commentCount
    FROM posts LEFT JOIN comments ON comments.post_id = posts.id
  `;
}

function publicPost(row) {
  if (!row) return null;
  return { ...row, commentCount: Number(row.commentCount) };
}

async function handleApi(req, res, url) {
  const route = url.pathname;
  const method = req.method;

  if (route === "/api/register" && method === "POST") {
    const body = await readJson(req);
    const name = cleanText(body.name, "Name", 60);
    const email = cleanText(body.email, "Email", 254).toLowerCase();
    const password = cleanText(body.password, "Password", 128);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw Object.assign(new Error("Enter a valid email address."), { status: 400 });
    }
    if (password.length < 8) {
      throw Object.assign(new Error("Password must be at least 8 characters."), { status: 400 });
    }
    const salt = crypto.randomBytes(16);
    const passwordHash = `${salt.toString("hex")}:${crypto.scryptSync(password, salt, 64).toString("hex")}`;
    let result;
    try {
      result = db.prepare("INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)").run(name, email, passwordHash);
    } catch (error) {
      if (error.code === "ERR_SQLITE_CONSTRAINT_UNIQUE" || error.errcode === 2067) {
        throw Object.assign(new Error("An account with that email already exists."), { status: 409 });
      }
      throw error;
    }
    const user = { id: Number(result.lastInsertRowid), name, email };
    const token = createSession(user.id);
    jsonResponse(res, 201, { user, token });
    return;
  }

  if (route === "/api/login" && method === "POST") {
    const body = await readJson(req);
    const email = cleanText(body.email, "Email", 254).toLowerCase();
    const password = cleanText(body.password, "Password", 128);
    const userRow = db.prepare("SELECT id, name, email, password_hash FROM users WHERE email = ?").get(email);
    let valid = false;
    if (userRow) {
      const [saltHex, hashHex] = userRow.password_hash.split(":");
      const expected = Buffer.from(hashHex, "hex");
      const actual = crypto.scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
      valid = crypto.timingSafeEqual(expected, actual);
    }
    if (!valid) throw Object.assign(new Error("Email or password is incorrect."), { status: 401 });
    const token = createSession(userRow.id);
    jsonResponse(res, 200, { user: { id: userRow.id, name: userRow.name, email: userRow.email }, token });
    return;
  }

  if (route === "/api/logout" && method === "POST") {
    const match = (req.headers.authorization || "").match(/^Bearer ([a-f0-9]{64})$/);
    if (match) {
      const tokenHash = crypto.createHash("sha256").update(match[1]).digest("hex");
      db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
    }
    jsonResponse(res, 200, { ok: true });
    return;
  }

  if (route === "/api/me" && method === "GET") {
    const user = authenticate(req);
    jsonResponse(res, 200, { user });
    return;
  }

  if (route === "/api/posts" && method === "GET") {
    const posts = db.prepare(`${postSelect()} GROUP BY posts.id ORDER BY posts.created_at DESC`).all().map(publicPost);
    jsonResponse(res, 200, { posts });
    return;
  }

  if (route === "/api/posts" && method === "POST") {
    const user = requireUser(req);
    const body = await readJson(req);
    const title = cleanText(body.title, "Title", 120);
    const excerpt = cleanText(body.excerpt, "Excerpt", 240);
    const content = cleanText(body.body, "Story", 20000);
    const category = cleanText(body.category || "Notes", "Category", 40);
    const imageUrl = cleanText(body.imageUrl, "Image URL", 500, false);
    const result = db.prepare(`
      INSERT INTO posts (user_id, author_name, title, excerpt, body, category, image_url)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(user.id, user.name, title, excerpt, content, category, imageUrl);
    const post = db.prepare(`${postSelect()} WHERE posts.id = ? GROUP BY posts.id`).get(result.lastInsertRowid);
    jsonResponse(res, 201, { post: publicPost(post) });
    return;
  }

  const postMatch = route.match(/^\/api\/posts\/(\d+)$/);
  if (postMatch) {
    const postId = Number(postMatch[1]);
    if (method === "GET") {
      const post = db.prepare(`${postSelect()} WHERE posts.id = ? GROUP BY posts.id`).get(postId);
      if (!post) throw Object.assign(new Error("Post not found."), { status: 404 });
      jsonResponse(res, 200, { post: publicPost(post) });
      return;
    }
    if (method === "PUT") {
      const user = requireUser(req);
      const body = await readJson(req);
      const post = db.prepare("SELECT user_id FROM posts WHERE id = ?").get(postId);
      if (!post) throw Object.assign(new Error("Post not found."), { status: 404 });
      if (post.user_id !== user.id) throw Object.assign(new Error("You can only edit your own posts."), { status: 403 });
      const title = cleanText(body.title, "Title", 120);
      const excerpt = cleanText(body.excerpt, "Excerpt", 240);
      const content = cleanText(body.body, "Story", 20000);
      const category = cleanText(body.category || "Notes", "Category", 40);
      const imageUrl = cleanText(body.imageUrl, "Image URL", 500, false);
      db.prepare(`
        UPDATE posts SET title = ?, excerpt = ?, body = ?, category = ?, image_url = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(title, excerpt, content, category, imageUrl, postId);
      const updated = db.prepare(`${postSelect()} WHERE posts.id = ? GROUP BY posts.id`).get(postId);
      jsonResponse(res, 200, { post: publicPost(updated) });
      return;
    }
    if (method === "DELETE") {
      const user = requireUser(req);
      const post = db.prepare("SELECT user_id FROM posts WHERE id = ?").get(postId);
      if (!post) throw Object.assign(new Error("Post not found."), { status: 404 });
      if (post.user_id !== user.id) throw Object.assign(new Error("You can only delete your own posts."), { status: 403 });
      db.prepare("DELETE FROM posts WHERE id = ?").run(postId);
      jsonResponse(res, 200, { ok: true });
      return;
    }
  }

  const commentsMatch = route.match(/^\/api\/posts\/(\d+)\/comments$/);
  if (commentsMatch && method === "GET") {
    const postId = Number(commentsMatch[1]);
    if (!db.prepare("SELECT id FROM posts WHERE id = ?").get(postId)) {
      throw Object.assign(new Error("Post not found."), { status: 404 });
    }
    const comments = db.prepare(`
      SELECT id, post_id AS postId, user_id AS userId, author_name AS author, body, created_at AS createdAt
      FROM comments WHERE post_id = ? ORDER BY created_at ASC
    `).all(postId);
    jsonResponse(res, 200, { comments });
    return;
  }

  if (commentsMatch && method === "POST") {
    const user = requireUser(req);
    const postId = Number(commentsMatch[1]);
    if (!db.prepare("SELECT id FROM posts WHERE id = ?").get(postId)) {
      throw Object.assign(new Error("Post not found."), { status: 404 });
    }
    const body = await readJson(req);
    const text = cleanText(body.body, "Comment", 2000);
    const result = db.prepare("INSERT INTO comments (post_id, user_id, author_name, body) VALUES (?, ?, ?, ?)")
      .run(postId, user.id, user.name, text);
    const comment = db.prepare(`
      SELECT id, post_id AS postId, user_id AS userId, author_name AS author, body, created_at AS createdAt
      FROM comments WHERE id = ?
    `).get(result.lastInsertRowid);
    jsonResponse(res, 201, { comment });
    return;
  }

  const commentMatch = route.match(/^\/api\/comments\/(\d+)$/);
  if (commentMatch && method === "DELETE") {
    const user = requireUser(req);
    const comment = db.prepare("SELECT user_id FROM comments WHERE id = ?").get(Number(commentMatch[1]));
    if (!comment) throw Object.assign(new Error("Comment not found."), { status: 404 });
    if (comment.user_id !== user.id) throw Object.assign(new Error("You can only delete your own comments."), { status: 403 });
    db.prepare("DELETE FROM comments WHERE id = ?").run(Number(commentMatch[1]));
    jsonResponse(res, 200, { ok: true });
    return;
  }

  jsonResponse(res, 404, { error: "API endpoint not found." });
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, datetime('now', ?))")
    .run(tokenHash, userId, `+${SESSION_DAYS} days`);
  return token;
}

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml"
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (url.pathname.startsWith("/api/")) {
    try {
      await handleApi(req, res, url);
    } catch (error) {
      if (!res.headersSent && !res.destroyed) {
        const status = error.status || 500;
        if (status === 500) console.error("API error:", error);
        jsonResponse(res, status, { error: status === 500 ? "An unexpected server error occurred." : error.message });
      }
    }
    return;
  }

  const requestedPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.resolve(PUBLIC_DIR, `.${requestedPath}`);
  if (!filePath.startsWith(`${PUBLIC_DIR}${path.sep}`)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (error, contents) => {
    if (error) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": contentTypes[path.extname(filePath)] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff"
    });
    res.end(contents);
  });
});

server.listen(PORT, () => {
  console.log(`MARGIN is ready at http://localhost:${PORT}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    db.close();
    server.close(() => process.exit(0));
  });
}
