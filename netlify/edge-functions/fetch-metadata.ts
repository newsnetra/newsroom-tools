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
    function getBylineFromHtml(html: string): string | null {
        // 1) Meta tags
        let by =
            meta("article:author") ||
            meta("og:article:author") ||
            meta("author") ||
            meta("parsely-author") ||        // common on news sites
            meta("dc.creator") ||            // Dublin Core
            meta("byl");                     // NYT-style

        // Sometimes article:author is a URL to the author page; ignore if it looks like a URL
        if (by && /^https?:\/\//i.test(by)) by = null;

        if (by) return by.trim() || null;

        // 2) Microdata (content attribute)
        const itempropContent = get(/itemprop=["']author["'][^>]*content=["']([^"']+)["']/i);
        if (itempropContent) return itempropContent;

        // 3) Microdata (visible text)
        const relAuthor = get(/<a[^>]+rel=["']author["'][^>]*>([^<]+)<\/a>/i);
        if (relAuthor) return relAuthor;

        // common Ghost/Theme selectors (best-effort text scrape)
        const classText =
            get(/class=["'][^"']*(?:post-full-author-name|author-link|byline|post-card-byline-author)[^"']*["'][^>]*>([^<]+)</i) ||
            null;
        if (classText) return classText.trim() || null;

        return null;
    }

    function getBylineFromJsonLd(html: string): string | null {
        // Pull every <script type="application/ld+json"> and parse safely
        const scripts = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
        for (const m of scripts) {
            const raw = m[1];
            try {
                const data = JSON.parse(raw);

                // Normalize to array
                const items = Array.isArray(data) ? data : [data];

                for (const node of items) {
                    // Sometimes wrapped in @graph
                    const graphs = node?.["@graph"] && Array.isArray(node["@graph"]) ? node["@graph"] : [node];

                    for (const g of graphs) {
                        const type = (g?.["@type"] || "").toString().toLowerCase();

                        // Look at Article/NewsArticle/BlogPosting nodes
                        if (/(article|newsarticle|blogposting)$/.test(type)) {
                            // author can be object or array
                            const a = g.author ?? g.creator ?? g.contributor;
                            const name =
                                (Array.isArray(a) ? a.map(x => x?.name).find(Boolean) : a?.name) ||
                                (typeof a === "string" ? a : null);
                            if (name && typeof name === "string" && name.trim()) return name.trim();
                        }

                        // Some sites put a Person node separately
                        if (type === "person" && typeof g.name === "string" && g.name.trim()) {
                            return g.name.trim();
                        }
                    }
                }
            } catch {
                // ignore bad JSON blocks
            }
        }
        return null;
    }
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
