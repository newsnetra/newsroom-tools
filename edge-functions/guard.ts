export default async (req: Request) => {
  const auth = req.headers.get("authorization");
  const expectedUser = Deno.env.get("BASIC_USER") ?? "user";
  const expectedPass = Deno.env.get("SITE_PASSWORD");

  if (!expectedPass) {
    return new Response("Server misconfigured: missing SITE_PASSWORD.", { status: 500 });
  }

  if (!auth?.startsWith("Basic ")) {
    return new Response("Authentication required.", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="Restricted"' },
    });
  }

  const [user, pass] = atob(auth.split(" ")[1]).split(":");
  if (user === expectedUser && pass === expectedPass) {
    // Auth OK → continue to _redirects (which proxies to GH Pages)
    return fetch(req);
  }

  return new Response("Unauthorized", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Restricted"' },
  });
};
