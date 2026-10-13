/** 只提取题目标识；绝不访问粘贴地址，不发送分享参数或片段。 */
export function parseQuestionLink(input: string): { slug: string; canonical: string } {
  if (typeof input !== "string" || input.length > 4096) throw new Error("链接过长，请粘贴单个力扣中国站题目链接");
  let raw = input.trim();
  if (!raw || /[\s\u0000-\u001f\u007f\\]/.test(raw)) throw new Error("请粘贴单个完整链接，不要包含分享文案或换行");
  if (/^(?:www\.)?(?:leetcode\.cn|leetcode-cn\.com)(?:\/|$)/i.test(raw)) raw = "https://" + raw;
  if (!/^https?:\/\//i.test(raw)) throw new Error("仅支持 HTTP 或 HTTPS 的力扣中国站题目链接");
  const parts = raw.match(/^https?:\/\/([^/?#]+)([^?#]*)/i);
  if (!parts || (parts[1].includes("%") || parts[1].includes("@"))) throw new Error("链接地址格式无效");
  // WHATWG URL 会自动消除点路径、转换反斜杠；必须在规范化前拒绝这些歧义。
  let path: string;
  try { path = decodeURIComponent(parts[2]); } catch { throw new Error("链接包含无效的编码"); }
  if (/[\u0000-\u001f\u007f]/.test(path) || path.includes("\\") || /%2f|%5c/i.test(parts[2]) || path.split("/").some(p => p === "." || p === "..")) {
    throw new Error("链接路径存在歧义，请从官方题面重新复制");
  }
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("链接格式无效"); }
  const hosts = new Set(["leetcode.cn", "www.leetcode.cn", "leetcode-cn.com", "www.leetcode-cn.com"]);
  if (!hosts.has(url.hostname.toLowerCase()) || url.username || url.password || (url.port && url.port !== "443")) {
    throw new Error("仅支持力扣中国站官方域名；不支持国际站、短链或其他网站");
  }
  const match = path.match(/^\/problems\/([A-Za-z0-9][A-Za-z0-9-]{0,159})(?:\/(.*))?$/)
    ?? path.match(/^\/contest\/[A-Za-z0-9-]+\/problems\/([A-Za-z0-9][A-Za-z0-9-]{0,159})(?:\/(.*))?$/);
  if (!match || (match[2] && !/^(?:description|solutions?|submissions?|discussion|discuss|editorial|comments)(?:\/|$)/.test(match[2]))) {
    throw new Error("未找到题目标识，请粘贴题面、题解或该题提交记录页面的链接");
  }
  return { slug: match[1], canonical: "https://leetcode.cn/problems/" + match[1] + "/" };
}
