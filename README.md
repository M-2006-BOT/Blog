# MARGIN

A small, full-stack blogging platform with account registration, sign-in, post management, and comments. It uses Node.js built-ins and SQLite, so no package installation is needed.

## Run locally

Requires Node.js 22.5 or later.

```powershell
npm start
```

Open [http://localhost:3000](http://localhost:3000). The SQLite database (`blog.sqlite`) is created in the project directory on first run and seeded with a few sample stories.

Set `PORT` to change the listening port, or `DATABASE_PATH` to store the SQLite database elsewhere.

## REST API

- `POST /api/register`, `POST /api/login`, `POST /api/logout`, `GET /api/me`
- `GET /api/posts`, `POST /api/posts`
- `GET /api/posts/:id`, `PUT /api/posts/:id`, `DELETE /api/posts/:id`
- `GET /api/posts/:id/comments`, `POST /api/posts/:id/comments`
- `DELETE /api/comments/:id`

Authenticated routes accept a bearer token in the `Authorization` header. Users can edit or delete only their own posts and comments.
