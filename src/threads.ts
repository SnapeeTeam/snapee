export function normalizeThreadsUrl(input: string): string | null {
  try {
    const url = new URL(input.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !['threads.net', 'www.threads.net', 'threads.com', 'www.threads.com'].includes(url.hostname)) return null;
    const match = url.pathname.match(/^\/@([a-zA-Z0-9._]+)\/post\/([a-zA-Z0-9_-]+)(?:\/|$)/);
    return match ? `https://www.threads.com/@${match[1]}/post/${match[2]}` : null;
  } catch { return null; }
}
export function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (entity, code: string) => {
    const common: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
    if (code.startsWith('#')) {
      const n = code[1]?.toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : entity;
    }
    return common[code.toLowerCase()] ?? entity;
  });
}
export function parseOg(html: string): { text: string | null; author: string | null; title: string | null } {
  const tags: Record<string, string> = {};
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs: Record<string, string> = {};
    for (const attr of match[0].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
      attrs[attr[1]!.toLowerCase()] = decodeEntities(attr[2] ?? attr[3] ?? attr[4] ?? '');
    }
    const key = attrs.property ?? attrs.name;
    if (key && attrs.content !== undefined) tags[key.toLowerCase()] = attrs.content;
  }
  const title = tags['og:title'] ?? null;
  const author = title?.match(/@([\w.]+)/)?.[1] ?? null;
  let text = tags['og:description']?.trim() ?? null;
  // Only remove an explicit attribution, never a bare @ mention in the post.
  if (text && author) text = text.replace(new RegExp('^@' + author.replaceAll('.', '\\.') + '\\s*(?:on Threads)?\\s*:\\s*'), '');
  return { text, author, title };
}
export interface ThreadsResult {
  ok: boolean; reason: string | null; text: string | null; author: string | null;
  finalUrl: string; htmlLength: number; title: string | null; loginWall: boolean; status: number | null;
}
export async function fetchThreads(input: string, ua = 'facebookexternalhit/1.1'): Promise<ThreadsResult> {
  const url = normalizeThreadsUrl(input);
  if (!url) throw new Error('Threads 網址格式不正確');
  const result: ThreadsResult = { ok: false, reason: null, text: null, author: null,
    finalUrl: url, htmlLength: 0, title: null, loginWall: false, status: null };
  try {
    // Follow only known public Meta hosts, with a bounded redirect count.
    let response: Response | undefined;
    for (let i = 0; i < 5; i++) {
      response = await fetch(result.finalUrl, { headers: { 'user-agent': ua, accept: 'text/html' }, redirect: 'manual', signal: AbortSignal.timeout(15000) });
      result.status = response.status;
      if (response.status < 300 || response.status >= 400) break;
      const location = response.headers.get('location');
      if (!location) break;
      const next = new URL(location, result.finalUrl);
      if (next.protocol !== 'https:' || next.port || next.username || next.password ||
        !['threads.com', 'www.threads.com', 'threads.net', 'www.threads.net', 'www.facebook.com', 'facebook.com'].includes(next.hostname)) {
        result.reason = 'redirect_blocked'; return result;
      }
      result.finalUrl = next.href;
    }
    if (!response) throw new Error('fetch_failed');
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let html = ''; let bytes = 0;
    if (reader) {
      while (true) {
        const chunk = await reader.read(); if (chunk.done) break;
        bytes += chunk.value.length;
        if (bytes > 2_500_000) { await reader.cancel(); result.reason = 'html_too_large'; return result; }
        html += decoder.decode(chunk.value, { stream: true });
      }
      html += decoder.decode();
    }
    result.htmlLength = html.length;
    result.title = decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '');
    result.loginWall = /unsupportedbrowser|\/login|登入以繼續|log in to continue/i.test(result.finalUrl + ' ' + result.title);
    const og = parseOg(html); result.text = og.text; result.author = og.author;
    result.reason = !response.ok ? `http_${response.status}` : !og.text ? 'no_og_description' : og.text.length < 4 ? 'text_too_short' : null;
    result.ok = result.reason === null;
    return result;
  } catch { result.reason = 'fetch_failed'; return result; }
}
