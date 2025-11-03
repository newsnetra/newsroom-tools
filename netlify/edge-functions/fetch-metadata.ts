const NETRA_ALLOW = /^https:\/\/([a-z0-9-]+\.)*netra\.news(\/|$)/i;

// TEMP: set "*" to debug quickly; once it works, change to your origin:
// const ALLOW_ORIGIN = "https://interactive.netra.news";
const ALLOW_ORIGIN = "*";

export default async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("", { status: 204, headers: cors() });
  }

  const urlParam = new URL(req.url).searchParams.get("url")?.trim();
  if (!urlParam) return json({ error: "Missing ?url=" }, 400);

  if (!NETRA_ALLOW.test(urlParam)) {
    return json({ error: "Domain not allowed" }, 403);
  }

  const upstream = await fetch(urlParam, {
    redirect: "follow",
    headers: { "User-Agent": "NetlifyEdgeMetadataBot/1.0 (+metadata-fetch)" }
  });

  if (!upstream.ok) {
    return json({ error: `Upstream ${upstream.status}` }, 502);
  }

  const html = await upstream.text();

  const get = (re: RegExp) => (html.match(re)?.[1] || "").trim() || null;
  const meta = (name: string) =>
    get(new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*content=["']([^"']+)["']`, "i"));

  const title =
    meta("og:title") || meta("twitter:title") || get(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const byline =
    meta("article:author") || meta("og:article:author") || meta("author");
  const published =
    meta("article:published_time") || meta("og:article:published_time") || meta("publication_date") || meta("date");
  const description = meta("og:description") || meta("twitter:description") || meta("description");
  const canonical = get(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i);

  const payload = { url: urlParam, title, byline, published, description, canonical };

  if (!title || !byline || !published) {
    return json(
      { error: "Required fields missing", required: ["title", "byline", "published"], found: payload },
      422
    );
  }

  return json(payload, 200, { "Cache-Control": "public, max-age=900, s-maxage=900" });
};

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...cors(), ...extra }
  });
}

function cors() {
  return {
    "Access-Control-Allow-Origin": ALLOW_ORIGIN,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}
