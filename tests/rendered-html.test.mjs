import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the family album home page", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html lang="zh-CN">/i);
  assert.match(html, /<title>亲宝贝家庭云相册<\/title>/i);
  assert.match(html, /添加照片 \/ 视频/);
  assert.match(html, /百度网盘入口/);
  assert.match(html, /打开百度网盘手动上传/);
  assert.match(html, /不会自动出现在百度网盘/);
  assert.match(html, /时间线/);
  assert.match(html, /第一次自己扶站/);
  assert.match(html, /生日蛋糕练习吹蜡烛/);
});

test("removes starter preview artifacts", async () => {
  const [page, layout, packageJson, readme] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../README.md", import.meta.url), "utf8"),
  ]);

  assert.match(page, /MemoryHome/);
  assert.match(layout, /lang="zh-CN"/);
  assert.match(packageJson, /"name": "qinbaobei-family-cloud-album"/);
  assert.match(readme, /亲宝贝家庭云相册/);

  assert.doesNotMatch(page, /codex-preview|SkeletonPreview|_sites-preview/);
  assert.doesNotMatch(layout, /Starter Project|codex-preview|_sites-preview/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton|site-creator-vinext-starter/);

  await assert.rejects(access(new URL("app/_sites-preview", projectRoot)));
});
