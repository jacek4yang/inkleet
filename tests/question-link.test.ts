import { test } from "node:test";
import assert from "node:assert/strict";
import { parseQuestionLink } from "../src/question-link.ts";
test("题面、题解、提交与旧中国站链接归一到同一题目", () => {
  for (const link of [
    "https://leetcode.cn/problems/two-sum",
    "  https://leetcode.cn/problems/two-sum/  ",
    "https://leetcode.cn/problems/two-sum/description/?envType=study-plan-v2&envId=top-100-liked#example",
    "https://leetcode.cn/problems/two-sum/solutions/123/a-solution/",
    "https://leetcode.cn/problems/two-sum/solution/old-solution/",
    "https://leetcode.cn/problems/two-sum/submissions/123/",
    "https://leetcode.cn/problems/two-sum/comments/",
    "http://leetcode-cn.com/problems/two-sum/",
    "www.leetcode.cn/problems/two-sum/",
    "leetcode.cn/problems/two-sum/",
    "https://LEETCODE.CN:443/problems/two-sum/",
    "https://leetcode.cn/contest/weekly-contest-123/problems/two-sum/",
    "https://leetcode.cn/problems/%74wo-sum/",
  ]) assert.deepEqual(parseQuestionLink(link), { slug: "two-sum", canonical: "https://leetcode.cn/problems/two-sum/" }, link);
});
test("保留大小写题目标识，完全丢弃分享查询和片段", () => {
  assert.equal(parseQuestionLink("https://leetcode.cn/problems/ZL6zAn/?redirect=https://evil.example#private").slug, "ZL6zAn");
  assert.equal(parseQuestionLink("https://leetcode.cn/problems/two-sum/?token=private#private").canonical, "https://leetcode.cn/problems/two-sum/");
});
test("拒绝伪域名、凭据、协议、端口和无题目标识的地址", () => {
  for (const link of [
    "", "two-sum", "https://leetcode.com/problems/two-sum/", "https://leetcode.cn.evil.example/problems/two-sum/",
    "https://evil.example/leetcode.cn/problems/two-sum/", "https://evil.example@leetcode.cn/problems/two-sum/",
    "https://leetcode.cn@evil.example/problems/two-sum/", "https://leetcode.cn:8443/problems/two-sum/",
    "https://leetcode.cn./problems/two-sum/", "https://%6ceetcode.cn/problems/two-sum/",
    "javascript:alert(1)", "file:///problems/two-sum/", "//leetcode.cn/problems/two-sum/",
    "https://leetcode.cn/problemset/", "https://leetcode.cn/problems/", "https://leetcode.cn/submissions/detail/123/",
    "https://leetcode.cn/problems/two-sum/not-a-question-tab/", "https://leetcode.cn/problems/a_b/",
    "https://leetcode.cn/problems/" + "x".repeat(161) + "/", "https://leetcode.cn/problems/two-sum/ " + "x".repeat(4096),
    "分享： https://leetcode.cn/problems/two-sum/", "https://leetcode.cn/problems/two-sum/ https://leetcode.cn/problems/other/"
  ]) assert.throws(() => parseQuestionLink(link), undefined, link);
});
test("拒绝 URL 规范化、编码分隔符与路径穿越歧义", () => {
  for (const path of [
    "/problems/two-sum/../other/", "/problems/%2e%2e/two-sum/", "/x/../problems/two-sum/",
    "/problems/two-sum%2fsubmissions/", "/problems/two-sum%5csubmissions/", "/problems/%ZZ/",
    "/problems/%252e%252e/", "/problems//two-sum/", "/problems/two-sum/./",
    "/problems/two-sum/\n/description/", "/problems/two-sum/\\description/"
  ]) assert.throws(() => parseQuestionLink("https://leetcode.cn" + path), undefined, path);
});
