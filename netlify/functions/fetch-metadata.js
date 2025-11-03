// Node 18+ runtime on Netlify
const ALLOWED_ORIGINS = [
  // change this to your exact GitHub Pages origin to be stricter:
  // "https://yourname.github.io",
  "*"
];

// Only allow netra.news and its subdomains
const NETRA_ALLOW = /^https:\/\/([a-z0-9-]+\.)*netra\.news(\/|$)/i;

export default async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      return res.status(204).send("");
    }

    const url = (req.query?.url || req.body?.url || "").trim();
    if (!url) return res.status(400).json({ error: "Missing ?url=" });

    if (!NETRA_ALLOW.test(url)) {
      return res.status(403).json({ error: "Domain not allowed" });
    }

    // Fetch HTML server-side (no CORS issue here)
    const r = await fetch(url, {
      redirect: "follow",
      headers: {
        "User-Agent": "NetlifyFunctionMetadataBot/1.0 (+metadata-fetch)"
      }
    });

    if (!r.ok) {
      return res.status(502).json({ error: `Upstream ${r.status} ${r.statusText}` });
    }

    const html = await r.text();

    // ---- Parse meta tags ----
    // lightweight parsing with regex + DOM as fallback
    // (Netlify Node18 has undici + no JSDOM by default; regex is fine for meta tags)
    const getMetaContent = (nameOrProp) => {
      const pattern = new RegExp(
        `<meta[^>]+(?:name|property)=["']${nameOrProp}["'][^>]*content=["']([^"']+)["'][^>]*>`,
        "i"
      );
      const m = html.match(pattern);
      return m ? m[1].trim() : null;
    };

    const getTitle = () => {
      const og = getMetaContent("og:title");
      if (og) return og;
      const tw = getMetaContent("twitter:title");
      if (tw) return tw;
      const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      return t ? t[1].trim() : null;
    };

    const getByline = () => {
      // Your rule: prefer OG author; fallback to meta[name=author]
      const ogAuthor = getMetaContent("article:author") || getMetaContent("og:article:author");
      const metaAuthor = (() => {
        const m = html.match(/<meta[^>]+name=["']author["'][^>]*content=["']([^"']+)["'][^>]*>/i);
        return m ? m[1].trim() : null;
      })();
      return ogAuthor || metaAuthor || null;
    };

    const getPublished = () => {
      // common publish-time metas
      return (
        getMetaContent("article:published_time") ||
        getMetaContent("og:article:published_time") ||
        getMetaContent("publication_date") ||
        getMetaContent("date") ||
        null
      );
    };

    const getDescription = () => {
      return (
        getMetaContent("og:description") ||
        getMetaContent("twitter:description") ||
        (() => {
          const m = html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']+)["'][^>]*>/i);
          return m ? m[1].trim() : null;
        })()
      );
    };

    const getCanonical = () => {
      const m = html.match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["'][^>]*>/i);
      return m ? m[1].trim() : null;
    };

    const payload = {
      url,
      title: getTitle(),
      byline: getByline(),
      published: getPublished(),
      description: getDescription(),
      canonical: getCanonical()
    };

    // Enforce your rule: without byline, title, publish date, don’t return success
    if (!payload.title || !payload.byline || !payload.published) {
      return res.status(422).json({
        error: "Required fields missing",
        required: ["title", "byline", "published"],
        found: payload
      });
    }

    // CORS headers
    const origin = req.headers.origin || "";
    const allowOrigin = ALLOWED_ORIGINS.includes("*") || ALLOWED_ORIGINS.includes(origin) ? origin || "*" : "*";

    res.setHeader("Access-Control-Allow-Origin", allowOrigin);
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Cache-Control", "public, max-age=900, s-maxage=900");

    return res.status(200).json(payload);
  } catch (err) {
    return res.status(500).json({ error: "Server error", details: String(err?.message || err) });
  }
};
