const state = {
  posts: [],
  user: null,
  token: localStorage.getItem("margin_token"),
  authMode: "login",
  editingPost: null,
  activePostId: null,
  toastTimer: null
};

const $ = selector => document.querySelector(selector);
const authDialog = $("#authDialog");
const editorDialog = $("#editorDialog");
const articleDialog = $("#articleDialog");

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

async function api(url, options = {}) {
  const headers = { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const response = await fetch(url, { ...options, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && state.token) {
      setSession(null, null);
      updateHeader();
    }
    throw new Error(payload.error || "Something went wrong. Please try again.");
  }
  return payload;
}

function setSession(token, user) {
  state.token = token;
  state.user = user;
  if (token) localStorage.setItem("margin_token", token);
  else localStorage.removeItem("margin_token");
}

function updateHeader() {
  $("#loginButton").classList.toggle("hidden", Boolean(state.user));
  $("#userMenu").classList.toggle("hidden", !state.user);
  $("#userGreeting").textContent = state.user ? `Hello, ${state.user.name.split(" ")[0]}` : "";
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove("visible"), 2800);
}

function formattedDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function initials(name) {
  return name.split(/\s+/).slice(0, 2).map(part => part[0] || "").join("").toUpperCase();
}

function imageStyle(url) {
  return url ? `style="background-image:url('${escapeHtml(url.replace(/'/g, "%27"))}')"` : "";
}

function bylineMarkup(post) {
  return `<div class="byline">
    <span class="avatar">${escapeHtml(initials(post.author))}</span>
    <span>${escapeHtml(post.author)}</span><span class="byline-dot">·</span>
    <span>${escapeHtml(formattedDate(post.createdAt))}</span>
  </div>`;
}

function renderPosts() {
  const [featured, ...rest] = state.posts;
  $("#storyCount").textContent = `${state.posts.length} ${state.posts.length === 1 ? "story" : "stories"}`;
  $("#emptyState").classList.toggle("hidden", state.posts.length > 0);
  $("#featuredStory").classList.toggle("hidden", !featured);
  $("#storyGrid").classList.toggle("hidden", rest.length === 0);
  if (!featured) {
    $("#featuredStory").innerHTML = "";
    $("#storyGrid").innerHTML = "";
    return;
  }
  $("#featuredStory").innerHTML = `
    <div class="featured-image-wrap"><div class="featured-image" ${imageStyle(featured.imageUrl)}></div></div>
    <div class="featured-copy">
      <p class="category">${escapeHtml(featured.category)}</p>
      <h3>${escapeHtml(featured.title)}</h3>
      <p>${escapeHtml(featured.excerpt)}</p>
      ${bylineMarkup(featured)}
      <div class="featured-meta">${Number(featured.commentCount) || 0} comments <span>·</span> <span>Read story ↗</span></div>
    </div>`;
  $("#featuredStory").onclick = () => openArticle(featured.id);
  $("#storyGrid").innerHTML = rest.map(post => `
    <article class="story-card" data-post-id="${post.id}" tabindex="0" role="button" aria-label="Read ${escapeHtml(post.title)}">
      <div class="card-image-wrap"><div class="card-image" ${imageStyle(post.imageUrl)}></div></div>
      <div class="card-copy">
        <p class="category">${escapeHtml(post.category)}</p>
        <h3>${escapeHtml(post.title)}</h3>
        <p>${escapeHtml(post.excerpt)}</p>
        ${bylineMarkup(post)}
        <div class="featured-meta">${Number(post.commentCount) || 0} comments <span>·</span> <span>${escapeHtml(formattedDate(post.createdAt))}</span></div>
      </div>
    </article>`).join("");
  $("#storyGrid").querySelectorAll(".story-card").forEach(card => {
    const open = () => openArticle(Number(card.dataset.postId));
    card.addEventListener("click", open);
    card.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open();
      }
    });
  });
}

async function loadPosts() {
  try {
    const { posts } = await api("/api/posts");
    state.posts = posts;
    renderPosts();
  } catch (error) {
    showToast(error.message);
  }
}

function setAuthMode(mode) {
  state.authMode = mode;
  const registering = mode === "register";
  $("#authTitle").textContent = registering ? "A little space, just for you." : "Good to have you back.";
  $("#authDescription").textContent = registering ? "Join the conversation and share a story of your own." : "Sign in to pick up where you left off.";
  $("#nameField").classList.toggle("hidden", !registering);
  $("#authName").required = registering;
  $("#authPassword").autocomplete = registering ? "new-password" : "current-password";
  $("#authPassword").minLength = registering ? 8 : 1;
  $("#authSubmit").innerHTML = registering ? 'Create account <span aria-hidden="true">↗</span>' : 'Sign in <span aria-hidden="true">↗</span>';
  $(".auth-tab[data-mode='login']").classList.toggle("active", !registering);
  $(".auth-tab[data-mode='register']").classList.toggle("active", registering);
  $("#authError").textContent = "";
}

function openAuth(mode = "login") {
  setAuthMode(mode);
  authDialog.showModal();
}

function openEditor(post = null) {
  if (!state.user) {
    openAuth("login");
    showToast("Sign in to share a story.");
    return;
  }
  state.editingPost = post;
  $("#editorTitle").textContent = post ? "Give it a second look." : "Start with a thought.";
  $("#editorSubmit").innerHTML = post ? 'Save changes <span aria-hidden="true">↗</span>' : 'Publish story <span aria-hidden="true">↗</span>';
  $("#postTitle").value = post?.title || "";
  $("#postExcerpt").value = post?.excerpt || "";
  $("#postCategory").value = post?.category || "Notes";
  $("#postImage").value = post?.imageUrl || "";
  $("#postBody").value = post?.body || "";
  $("#editorError").textContent = "";
  editorDialog.showModal();
}

function commentMarkup(comment) {
  const removeButton = state.user && comment.userId === state.user.id
    ? `<button class="comment-delete" type="button" data-delete-comment="${comment.id}">Delete</button>`
    : "";
  return `<div class="comment">
    <div class="comment-head"><div><span class="comment-author">${escapeHtml(comment.author)}</span>
      <span class="comment-date">${escapeHtml(formattedDate(comment.createdAt))}</span></div>${removeButton}</div>
    <p class="comment-body">${escapeHtml(comment.body)}</p>
  </div>`;
}

async function openArticle(id) {
  const post = state.posts.find(item => item.id === id);
  if (!post) return;
  state.activePostId = id;
  const ownPost = state.user && post.userId === state.user.id;
  $("#articleContent").innerHTML = `
    ${post.imageUrl ? `<div class="article-hero" ${imageStyle(post.imageUrl)}></div>` : ""}
    <div class="article-header">
      <p class="category">${escapeHtml(post.category)}</p>
      <h2>${escapeHtml(post.title)}</h2>
      <p class="dialog-description">${escapeHtml(post.excerpt)}</p>
      <div class="article-byline">${bylineMarkup(post)}</div>
      ${ownPost ? `<div class="article-actions"><button type="button" id="editPostButton">Edit story</button> <button type="button" id="deletePostButton">Delete story</button></div>` : ""}
    </div>
    <div class="article-body">${post.body.split(/\n\s*\n/).map(paragraph => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`).join("")}</div>
    <section class="comments">
      <h3>In the conversation <span class="comment-total"></span></h3>
      <div id="commentList"><p class="dialog-description">Loading comments…</p></div>
      ${state.user
        ? `<form class="comment-form" id="commentForm"><label class="form-field">Leave a thoughtful note<textarea name="body" maxlength="2000" rows="3" placeholder="Add to the conversation…" required></textarea></label><p class="form-error" id="commentError"></p><button class="button button-dark comment-submit" type="submit">Post comment <span aria-hidden="true">↗</span></button></form>`
        : `<p class="comment-signin"><button type="button" id="commentSignin">Sign in</button> to join the conversation.</p>`}
    </section>`;
  if (!articleDialog.open) articleDialog.showModal();
  $("#editPostButton")?.addEventListener("click", () => {
    articleDialog.close();
    openEditor(post);
  });
  $("#deletePostButton")?.addEventListener("click", () => deletePost(post));
  $("#commentForm")?.addEventListener("submit", submitComment);
  $("#commentSignin")?.addEventListener("click", () => {
    articleDialog.close();
    openAuth("login");
  });
  await loadComments(id);
}

async function loadComments(postId) {
  const list = $("#commentList");
  if (!list || state.activePostId !== postId) return;
  try {
    const { comments } = await api(`/api/posts/${postId}/comments`);
    if (state.activePostId !== postId || !$("#commentList")) return;
    $(".comment-total").textContent = comments.length ? `(${comments.length})` : "";
    list.innerHTML = comments.length
      ? comments.map(commentMarkup).join("")
      : '<p class="dialog-description">No notes yet. You could be the first.</p>';
    list.querySelectorAll("[data-delete-comment]").forEach(button => {
      button.addEventListener("click", () => deleteComment(Number(button.dataset.deleteComment), postId));
    });
  } catch (error) {
    list.innerHTML = `<p class="form-error">${escapeHtml(error.message)}</p>`;
  }
}

async function submitComment(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const errorEl = $("#commentError");
  errorEl.textContent = "";
  try {
    await api(`/api/posts/${state.activePostId}/comments`, {
      method: "POST",
      body: JSON.stringify({ body: new FormData(form).get("body") })
    });
    await loadComments(state.activePostId);
    await loadPosts();
    form.reset();
  } catch (error) {
    errorEl.textContent = error.message;
  }
}

async function deleteComment(id, postId) {
  if (!window.confirm("Remove this comment?")) return;
  try {
    await api(`/api/comments/${id}`, { method: "DELETE" });
    await loadComments(postId);
    await loadPosts();
    showToast("Comment removed.");
  } catch (error) {
    showToast(error.message);
  }
}

async function deletePost(post) {
  if (!window.confirm(`Delete “${post.title}”? This also removes its comments.`)) return;
  try {
    await api(`/api/posts/${post.id}`, { method: "DELETE" });
    articleDialog.close();
    state.activePostId = null;
    showToast("Story deleted.");
    await loadPosts();
  } catch (error) {
    showToast(error.message);
  }
}

$("#loginButton").addEventListener("click", () => openAuth("login"));
$("#writeButton").addEventListener("click", () => openEditor());
$("#emptyWriteButton").addEventListener("click", () => openEditor());
$("#logoutButton").addEventListener("click", async () => {
  try {
    await api("/api/logout", { method: "POST" });
  } catch (error) {
    showToast(error.message);
  } finally {
    setSession(null, null);
    updateHeader();
    showToast("You’ve signed out.");
    await loadPosts();
  }
});

document.querySelectorAll(".dialog-close").forEach(button => {
  button.addEventListener("click", () => button.closest("dialog").close());
});
document.querySelectorAll(".dialog").forEach(dialog => {
  dialog.addEventListener("click", event => {
    if (event.target === dialog) dialog.close();
  });
});
document.querySelectorAll(".auth-tab").forEach(tab => {
  tab.addEventListener("click", () => setAuthMode(tab.dataset.mode));
});

$("#authForm").addEventListener("submit", async event => {
  event.preventDefault();
  const registering = state.authMode === "register";
  const body = {
    email: $("#authEmail").value,
    password: $("#authPassword").value
  };
  if (registering) body.name = $("#authName").value;
  $("#authError").textContent = "";
  $("#authSubmit").disabled = true;
  try {
    const { token, user } = await api(registering ? "/api/register" : "/api/login", {
      method: "POST",
      body: JSON.stringify(body)
    });
    setSession(token, user);
    updateHeader();
    authDialog.close();
    event.currentTarget.reset();
    showToast(registering ? "Welcome to MARGIN." : `Welcome back, ${user.name.split(" ")[0]}.`);
    if (state.activePostId) await openArticle(state.activePostId);
    else await loadPosts();
  } catch (error) {
    $("#authError").textContent = error.message;
  } finally {
    $("#authSubmit").disabled = false;
  }
});

$("#editorForm").addEventListener("submit", async event => {
  event.preventDefault();
  const post = {
    title: $("#postTitle").value,
    excerpt: $("#postExcerpt").value,
    category: $("#postCategory").value,
    imageUrl: $("#postImage").value,
    body: $("#postBody").value
  };
  $("#editorError").textContent = "";
  $("#editorSubmit").disabled = true;
  try {
    const editing = state.editingPost;
    const result = await api(editing ? `/api/posts/${editing.id}` : "/api/posts", {
      method: editing ? "PUT" : "POST",
      body: JSON.stringify(post)
    });
    editorDialog.close();
    state.editingPost = null;
    showToast(editing ? "Your changes are saved." : "Your story is out in the world.");
    await loadPosts();
    if (editing) await openArticle(result.post.id);
  } catch (error) {
    $("#editorError").textContent = error.message;
  } finally {
    $("#editorSubmit").disabled = false;
  }
});

async function initialize() {
  updateHeader();
  if (state.token) {
    try {
      const { user } = await api("/api/me");
      if (user) {
        state.user = user;
        updateHeader();
      } else {
        setSession(null, null);
      }
    } catch {
      setSession(null, null);
      updateHeader();
    }
  }
  await loadPosts();
}

initialize();
