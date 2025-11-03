// Deno/Edge runtime — no Node imports needed
// Passwords are read from env vars (never in code)

const COOKIE_NAME = "__site_auth";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

const loginPage = (errMsg = "") => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="robots" content="noindex, nofollow">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Protected</title>
  <style>
    body{font-family: system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
         background:#0b1724;color:#e9f0f6;display:grid;place-items:center;
         min-height:100dvh;margin:0;padding:24px}
    form{background:#0f2236;border:1px solid #2b4a68;border-radius:14px;padding:24px 20px;
         width:100%;max-width:380px;box-shadow:0 10px 30px rgba(0,0,0,.35)}
    h1{font-size:18px;margin:0 0 12px}
    p{margin:0 0 16px;color:#c7d7e6}
    .err{color:#ffb4b4;margin-bottom:12px}
    label{display:block;font-size:14px;margin-bottom:6px}
    input[type=password]{width:100%;padding:10px 12px;border-radius:10px;border:1px solid #2b4a68;background:#0b1724;color:#e9f0f6}
    button{margin-top:14px;width:100%;padding:10px 12px;border-radius:10px;border:0;background:#2eaadc;color:#072a3b;font-weight:700;cursor:pointer}
    button:hover{filter:brightness(1.05)}
    .hint{margin-top:10px;font-size:12px;color:#94b3cf;opacity:.9}
  </style>
</head>
<body>
  <form method="post">
    <h1>Enter password</h1>
    ${errMsg ? `<div class="err">${errMsg}</div>` : ""}
    <label for="password">Password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required>
    <button type="submit">Continue</button>
    <div class="hint">Access is limited to authorised users.</div>
  </form>
</body>
</html>`;

async function sha256Hex(str) {
  const buf = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i === -1) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setCookie(name, value, { maxAge, path = "/", secure = true, httpOnly = true, sameSite = "Lax" } = {}) {
  let v = `${name}=${encodeURIComponent(value)}; Path=${path}; SameSite=${sameSite}`;
  if (secure) v += "; Secure";
  if (httpOnly) v += "; HttpOnly";
  if (typeof maxAge === "number") v += `; Max-Age=${maxAge}`;
  return v;
}

export default async (request, context) => {
  const url = new URL(request.url);

  // Allow logout
  if (url.pathname === "/__logout") {
    return new Response(null, {
      status: 302,
      headers: {
        "Location": "/",
        "Set-Cookie": `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`
      }
    });
  }

  // Only protect the routes Netlify mapped here via netlify.toml.
  // (Everything else will never invoke this function.)

  const envPasswords = (Deno.env.get("PROTECT_PASSWORDS") || "").split(",").map(s => s.trim()).filter(Boolean);
  const secret = Deno.env.get("PROTECT_SECRET");

  if (envPasswords.length === 0 || !secret) {
    // Fail closed: refuse access until env vars are set
    return new Response(loginPage("Missing server configuration. Contact the admin."), {
      status: 503,
      headers: { "content-type": "text/html; charset=utf-8", "x-robots-tag": "noindex, nofollow" }
    });
  }

  // Check cookie
  const cookies = parseCookies(request.headers.get("cookie") || "");
  const cookieVal = cookies[COOKIE_NAME];

  if (cookieVal) {
    // Auth cookie is a hash of password + secret. Verify against all allowed passwords.
    for (const pw of envPasswords) {
      const token = await sha256Hex(`${pw}:${secret}`);
      if (cookieVal === token) {
        // Already authenticated — let the request through
        return context.next();
      }
    }
    // fallthrough to re-prompt on mismatch
  }

  // Handle login POST
  if (request.method === "POST") {
    const form = await request.formData();
    const password = String(form.get("password") || "");

    if (envPasswords.includes(password)) {
      const token = await sha256Hex(`${password}:${secret}`);
      const headers = new Headers({
        "Location": url.pathname + url.search,
        "Set-Cookie": setCookie(COOKIE_NAME, token, { maxAge: COOKIE_MAX_AGE })
      });
      return new Response(null, { status: 302, headers });
    } else {
      return new Response(loginPage("Incorrect password."), {
        status: 401,
        headers: { "content-type": "text/html; charset=utf-8", "x-robots-tag": "noindex, nofollow" }
      });
    }
  }

  // Show login form for GET (or any non-POST)
  return new Response(loginPage(), {
    status: 401,
    headers: { "content-type": "text/html; charset=utf-8", "x-robots-tag": "noindex, nofollow" }
  });
};
