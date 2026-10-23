const modules = import.meta.glob("../content/cases/*.md", { eager: true });
const cases = Object.values(modules)
  .map((entry) => entry)
  .sort((a, b) => Number(b.frontmatter.year ?? 0) - Number(a.frontmatter.year ?? 0));

const site = "https://thomasfredborg.dk";

const escapeXml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const mediaUrl = (path) => {
  const match = path?.match(/^\/media\/(.+)\.(png|jpe?g)$/i);
  return match ? `${site}/media-optimized/${match[1]}.webp` : `${site}${path}`;
};

export function GET() {
  const items = cases.map((item) => {
    const slug = item.file.split("/").pop()?.replace(/\.md$/, "");
    const title = item.frontmatter.title;
    const description =
      item.frontmatter.seoDescription ??
      item.frontmatter.intro ??
      "Selected work by Thomas Fredborg.";
    const url = `${site}/cases/${slug}/`;
    const image = item.frontmatter.cover ? mediaUrl(item.frontmatter.cover) : "";

    return `<item>
      <title>${escapeXml(title)}</title>
      <description>${escapeXml(description)}</description>
      <link>${escapeXml(url)}</link>
      <guid isPermaLink="true">${escapeXml(url)}</guid>
      ${image ? `<enclosure url="${escapeXml(image)}" type="image/webp" length="0" />` : ""}
    </item>`;
  }).join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Thomas Fredborg — Selected Work</title>
    <link>${site}/</link>
    <description>Selected work by Thomas Fredborg, Senior Art Director &amp; Graphic Designer.</description>
    <language>en-dk</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    ${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
    },
  });
}
