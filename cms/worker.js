import { SignJWT, importPKCS8 } from "jose";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

const OWNER = "fredborg11";
const REPO = "thomasfredborg-portfolio";
const BRANCH = "main";
const CASES_PATH = "src/content/cases";
const MEDIA_PATH = "public/media";
const API_VERSION = "2026-03-10";
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      return handleApi(request, env, url);
    }

    return env.ASSETS.fetch(request);
  }
};

async function handleApi(request, env, url) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  if (url.pathname === "/api/login" && request.method === "POST") {
    return login(request, env);
  }

  if (url.pathname === "/api/logout" && request.method === "POST") {
    return logout();
  }

  if (url.pathname === "/api/health" && request.method === "GET") {
    return json({ ok: true });
  }

  if (!await isAuthenticated(request, env)) {
    return json({ error: "Unauthorized" }, 401);
  }

  if (url.pathname === "/api/cases" && request.method === "GET") {
    return listCases(env);
  }

  if (url.pathname === "/api/cases" && request.method === "POST") {
    return saveCase(request, env);
  }

  if (url.pathname === "/api/upload" && request.method === "POST") {
    return uploadMedia(request, env);
  }

  if (url.pathname.startsWith("/api/cases/") && request.method === "GET") {
    const slug = decodeURIComponent(url.pathname.split("/").pop());
    return getCase(slug, env);
  }

  if (url.pathname.startsWith("/api/cases/") && request.method === "DELETE") {
    const slug = decodeURIComponent(url.pathname.split("/").pop());
    return deleteCase(slug, env);
  }

  return json({ error: "Not found" }, 404);
}

async function login(request, env) {
  try {
    const body = await request.json();
    const password = String(body?.password ?? "");

    if (!env.ADMIN_PASSWORD || password !== env.ADMIN_PASSWORD) {
      return json({ error: "Forkert adgangskode." }, 401);
    }

    const session = await signSession(env, 7 * 24 * 60 * 60);
    return json(
      { ok: true },
      200,
      { "Set-Cookie": sessionCookie(session, 7 * 24 * 60 * 60) }
    );
  } catch {
    return json({ error: "Ugyldig forespørgsel." }, 400);
  }
}

async function logout() {
  return json(
    { ok: true },
    200,
    { "Set-Cookie": sessionCookie("", 0) }
  );
}

async function isAuthenticated(request, env) {
  const cookie = request.headers.get("Cookie") || "";
  const session = cookie.match(/(?:^|; )tf_cms_session=([^;]+)/)?.[1];
  if (!session) return false;

  try {
    const [payloadB64, signatureB64] = session.split(".");
    if (!payloadB64 || !signatureB64) return false;

    const payload = JSON.parse(new TextDecoder().decode(base64urlDecode(payloadB64)));
    if (!payload?.exp || payload.exp < Math.floor(Date.now() / 1000)) return false;

    const secret = await hmacKey(env.SESSION_SECRET || env.ADMIN_PASSWORD);
    return await crypto.subtle.verify(
      "HMAC",
      secret,
      base64urlDecode(signatureB64),
      new TextEncoder().encode(payloadB64)
    );
  } catch {
    return false;
  }
}

async function signSession(env, seconds) {
  const payload = {
    sub: "admin",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + seconds
  };
  const payloadB64 = base64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await hmacKey(env.SESSION_SECRET || env.ADMIN_PASSWORD);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payloadB64)
  );
  return `${payloadB64}.${base64urlEncode(new Uint8Array(signature))}`;
}

function sessionCookie(value, maxAge) {
  return `tf_cms_session=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
}

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(String(secret || "")),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

async function githubRequest(env, path, options = {}) {
  const token = await getInstallationToken(env);
  return fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": API_VERSION,
      "User-Agent": "Thomas-Fredborg-Portfolio-CMS",
      ...(options.headers || {})
    }
  });
}

let tokenCache = null;

async function getInstallationToken(env) {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt - now > 60_000) {
    return tokenCache.token;
  }

  let privateKeyText = String(env.GITHUB_PRIVATE_KEY || "")
    .replace(/\\r?\\n/g, "\n")
    .trim();

  if (privateKeyText.startsWith('"') && privateKeyText.endsWith('"')) {
    privateKeyText = privateKeyText.slice(1, -1).replace(/\\r?\\n/g, "\n").trim();
  }

  if (!env.GITHUB_APP_ID || !privateKeyText) {
    throw new Error("GitHub App credentials are not configured.");
  }

  if (!privateKeyText.startsWith("-----BEGIN PRIVATE KEY-----")) {
    throw new Error("GITHUB_PRIVATE_KEY skal være en PKCS#8 PEM-nøgle (BEGIN PRIVATE KEY).");
  }

  const nowSeconds = Math.floor(now / 1000);
  const key = await importPKCS8(privateKeyText, "RS256");

  const jwt = await new SignJWT({})
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuedAt(nowSeconds - 60)
    .setExpirationTime(nowSeconds + 540)
    .setIssuer(String(env.GITHUB_APP_ID))
    .sign(key);

  let installationId = String(env.GITHUB_INSTALLATION_ID || "");
  if (!installationId) {
    const installationsResponse = await fetch("https://api.github.com/app/installations?per_page=100", {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${jwt}`,
        "X-GitHub-Api-Version": API_VERSION,
        "User-Agent": "Thomas-Fredborg-Portfolio-CMS"
      }
    });

    if (!installationsResponse.ok) {
      const detail = await installationsResponse.text();
      throw new Error(`Could not find GitHub App installation (${installationsResponse.status}): ${detail.slice(0, 500)}`);
    }

    const installations = await installationsResponse.json();
    const match = installations.find((item) => item.account?.login?.toLowerCase() === OWNER.toLowerCase());
    installationId = String(match?.id || "");
  }

  if (!installationId) {
    throw new Error("GitHub App is not installed on the portfolio repository/account.");
  }

  const response = await fetch(
    `https://api.github.com/app/installations/${encodeURIComponent(installationId)}/access_tokens`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${jwt}`,
        "X-GitHub-Api-Version": API_VERSION,
        "User-Agent": "Thomas-Fredborg-Portfolio-CMS"
      },
      body: JSON.stringify({
        repositories: [REPO],
        permissions: {
          contents: "write",
          metadata: "read"
        }
      })
    }
  );

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`GitHub token request failed (${response.status}): ${detail.slice(0, 500)}`);
  }

  const data = await response.json();
  tokenCache = {
    token: data.token,
    expiresAt: Date.parse(data.expires_at)
  };
  return tokenCache.token;
}

async function listCases(env) {
  try {
    const response = await githubRequest(
      env,
      `/repos/${OWNER}/${REPO}/contents/${CASES_PATH}?ref=${BRANCH}`
    );
    if (!response.ok) {
      return githubError(response, "Kunne ikke hente cases.");
    }

    const entries = await response.json();
    const files = entries.filter((entry) => entry.type === "file" && entry.name.endsWith(".md")).slice(0, 40);

    const cases = [];
    for (const file of files) {
      const contentResponse = await githubRequest(env, file.url.replace("https://api.github.com", ""));
      if (!contentResponse.ok) continue;

      const data = await contentResponse.json();
      const markdown = decodeBase64(data.content || "");
      const parsed = parseMarkdown(markdown);

      cases.push({
        slug: parsed.frontmatter.slug || file.name.replace(/\.md$/, ""),
        title: parsed.frontmatter.title || file.name,
        client: parsed.frontmatter.client || "",
        year: parsed.frontmatter.year || "",
        category: parsed.frontmatter.category || "",
        cover: parsed.frontmatter.cover || ""
      });
    }

    cases.sort((a, b) => Number(b.year || 0) - Number(a.year || 0));
    return json({ cases });
  } catch (error) {
    return json({ error: friendlyError(error) }, 500);
  }
}

async function getCase(slug, env) {
  if (!isSafeSlug(slug)) return json({ error: "Ugyldig slug." }, 400);

  try {
    const response = await githubRequest(
      env,
      `/repos/${OWNER}/${REPO}/contents/${CASES_PATH}/${slug}.md?ref=${BRANCH}`
    );
    if (!response.ok) {
      return githubError(response, "Casen kunne ikke hentes.");
    }

    const data = await response.json();
    const markdown = decodeBase64(data.content || "");

    return json({
      case: {
        ...parseMarkdown(markdown).frontmatter,
        body: parseMarkdown(markdown).body
      }
    });
  } catch (error) {
    return json({ error: friendlyError(error) }, 500);
  }
}

async function saveCase(request, env) {
  try {
    const input = await request.json();
    const caseData = normalizeCase(input);
    if (!caseData.slug || !isSafeSlug(caseData.slug)) {
      return json({ error: "Slug skal kun indeholde små bogstaver, tal og bindestreger." }, 400);
    }
    if (!caseData.title) {
      return json({ error: "Titel mangler." }, 400);
    }

    const path = `${CASES_PATH}/${caseData.slug}.md`;
    const current = await githubRequest(
      env,
      `/repos/${OWNER}/${REPO}/contents/${path}?ref=${BRANCH}`
    );

    let sha;
    if (current.ok) {
      sha = (await current.json()).sha;
    } else if (current.status !== 404) {
      return githubError(current, "Kunne ikke kontrollere casen.");
    }

    const markdown = serializeCase(caseData);
    const response = await githubRequest(env, `/repos/${OWNER}/${REPO}/contents/${path}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `${sha ? "Update" : "Create"} case: ${caseData.title}`,
        content: base64Encode(new TextEncoder().encode(markdown)),
        sha,
        branch: BRANCH
      })
    });

    if (!response.ok) {
      return githubError(response, "Casen kunne ikke gemmes.");
    }

    const result = await response.json();
    return json({
      ok: true,
      commit: result.commit?.sha || null,
      slug: caseData.slug
    });
  } catch (error) {
    return json({ error: friendlyError(error) }, 500);
  }
}

async function uploadMedia(request, env) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    const requestedName = String(form.get("filename") || "");

    if (!(file instanceof File)) {
      return json({ error: "Ingen fil modtaget." }, 400);
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      return json({ error: "Filen er for stor. Maksimum er 25 MB pr. fil." }, 413);
    }

    const mime = String(file.type || "").toLowerCase();
    const isImage = /^image\/(jpeg|png|webp)$/.test(mime);
    const isVideo = /^video\/(mp4|webm|quicktime)$/.test(mime);

    if (!isImage && !isVideo) {
      return json({ error: "Filtypen understøttes ikke. Brug JPG, PNG, WebP, MP4 eller WebM." }, 415);
    }

    const original = requestedName || file.name || "upload";
    const extension = extensionFromName(original, mime);
    const basename = sanitizeFilename(original.replace(/\.[^.]+$/, "")) || "media";
    const filename = `${Date.now()}-${basename}${extension}`;
    const path = `${MEDIA_PATH}/${filename}`;
    const bytes = new Uint8Array(await file.arrayBuffer());

    const commit = await commitGitBlob(env, path, bytes, `Upload media: ${filename}`);

    return json({
      ok: true,
      path: `/media/${filename}`,
      filename,
      kind: isVideo ? "video" : "image",
      commit
    });
  } catch (error) {
    return json({ error: friendlyError(error) }, 500);
  }
}

async function commitGitBlob(env, path, bytes, message) {
  const refResponse = await githubRequest(
    env,
    `/repos/${OWNER}/${REPO}/git/ref/heads/${encodeURIComponent(BRANCH)}`
  );
  if (!refResponse.ok) {
    return githubErrorThrow(refResponse, "Kunne ikke læse GitHub branch.");
  }

  const refData = await refResponse.json();
  const parentSha = refData.object?.sha;
  if (!parentSha) throw new Error("Kunne ikke finde den aktuelle branch commit.");

  const commitResponse = await githubRequest(
    env,
    `/repos/${OWNER}/${REPO}/git/commits/${parentSha}`
  );
  if (!commitResponse.ok) {
    return githubErrorThrow(commitResponse, "Kunne ikke læse GitHub commit.");
  }

  const commitData = await commitResponse.json();
  const baseTree = commitData.tree?.sha;
  if (!baseTree) throw new Error("Kunne ikke finde Git tree.");

  const blobResponse = await githubRequest(
    env,
    `/repos/${OWNER}/${REPO}/git/blobs`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: base64Encode(bytes),
        encoding: "base64"
      })
    }
  );
  if (!blobResponse.ok) {
    return githubErrorThrow(blobResponse, "Kunne ikke oprette filen i GitHub.");
  }

  const blobData = await blobResponse.json();

  const treeResponse = await githubRequest(
    env,
    `/repos/${OWNER}/${REPO}/git/trees`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        base_tree: baseTree,
        tree: [
          {
            path,
            mode: "100644",
            type: "blob",
            sha: blobData.sha
          }
        ]
      })
    }
  );
  if (!treeResponse.ok) {
    return githubErrorThrow(treeResponse, "Kunne ikke opdatere Git tree.");
  }

  const treeData = await treeResponse.json();

  const newCommitResponse = await githubRequest(
    env,
    `/repos/${OWNER}/${REPO}/git/commits`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        tree: treeData.sha,
        parents: [parentSha]
      })
    }
  );
  if (!newCommitResponse.ok) {
    return githubErrorThrow(newCommitResponse, "Kunne ikke oprette Git commit.");
  }

  const newCommitData = await newCommitResponse.json();

  const updateRefResponse = await githubRequest(
    env,
    `/repos/${OWNER}/${REPO}/git/refs/heads/${encodeURIComponent(BRANCH)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sha: newCommitData.sha })
    }
  );
  if (!updateRefResponse.ok) {
    return githubErrorThrow(updateRefResponse, "Kunne ikke opdatere GitHub branch.");
  }

  return newCommitData.sha;
}

async function githubErrorThrow(response, fallback) {
  let detail = "";
  try {
    const data = await response.json();
    detail = data?.message ? ` ${data.message}` : "";
  } catch {}
  throw new Error(`${fallback}${detail}`);
}

async function deleteCase(slug, env) {
  if (!isSafeSlug(slug)) return json({ error: "Ugyldig slug." }, 400);

  try {
    const path = `${CASES_PATH}/${slug}.md`;
    const current = await githubRequest(
      env,
      `/repos/${OWNER}/${REPO}/contents/${path}?ref=${BRANCH}`
    );

    if (current.status === 404) return json({ ok: true });
    if (!current.ok) return githubError(current, "Kunne ikke finde casen.");

    const data = await current.json();
    const response = await githubRequest(env, `/repos/${OWNER}/${REPO}/contents/${path}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `Delete case: ${slug}`,
        sha: data.sha,
        branch: BRANCH
      })
    });

    if (!response.ok) {
      return githubError(response, "Casen kunne ikke slettes.");
    }

    return json({ ok: true });
  } catch (error) {
    return json({ error: friendlyError(error) }, 500);
  }
}

function parseMarkdown(markdown) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: markdown };

  let frontmatter = {};
  try {
    frontmatter = parseYaml(match[1]) || {};
  } catch {
    frontmatter = {};
  }

  return { frontmatter, body: match[2] || "" };
}

function normalizeCase(input) {
  const array = (value) => Array.isArray(value) ? value.map(String).filter(Boolean) : [];
  return {
    title: String(input.title || "").trim(),
    slug: String(input.slug || "").trim().toLowerCase(),
    client: String(input.client || "").trim(),
    year: input.year ? Number(input.year) : "",
    category: String(input.category || "").trim(),
    role: String(input.role || "").trim(),
    tags: array(input.tags),
    intro: String(input.intro || "").trim(),
    cover: String(input.cover || "").trim(),
    gallery: array(input.gallery),
    video: String(input.video || "").trim(),
    body: String(input.body || "").trim()
  };
}

function serializeCase(data) {
  const frontmatter = {
    title: data.title,
    slug: data.slug,
    client: data.client || "",
    year: data.year || "",
    category: data.category || "",
    role: data.role || "",
    tags: data.tags || [],
    intro: data.intro || "",
    cover: data.cover || "",
    gallery: data.gallery || [],
    video: data.video || ""
  };

  return `---\n${stringifyYaml(frontmatter, { lineWidth: 0 }).trim()}\n---\n${data.body ? data.body + "\n" : ""}`;
}

function isSafeSlug(slug) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
}

function sanitizeFilename(value) {
  return value
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()
    .slice(0, 100);
}

function extensionFromName(name, mime) {
  const byName = name.match(/\.[a-z0-9]+$/i)?.[0]?.toLowerCase();
  if (byName && /\.(jpe?g|png|webp|mp4|webm|mov)$/.test(byName)) {
    return byName === ".jpeg" ? ".jpg" : byName;
  }
  if (mime.includes("jpeg")) return ".jpg";
  if (mime.includes("png")) return ".png";
  if (mime.includes("webp")) return ".webp";
  if (mime.includes("mp4")) return ".mp4";
  if (mime.includes("webm")) return ".webm";
  return "";
}

function decodeBase64(value) {
  const binary = atob(value.replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function base64Encode(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return btoa(binary);
}

function base64urlEncode(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64urlDecode(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(normalized + padding);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function friendlyError(error) {
  return error instanceof Error ? error.message : "Der opstod en ukendt fejl.";
}

async function githubError(response, fallback) {
  try {
    const data = await response.json();
    const message = data?.message ? ` ${data.message}` : "";
    return json({ error: `${fallback}${message}` }, response.status || 500);
  } catch {
    return json({ error: fallback }, response.status || 500);
  }
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS"
  };
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...extraHeaders,
      ...corsHeaders()
    }
  });
}
