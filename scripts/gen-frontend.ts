const DIST_DIR = "./frontend/dist";
const OUT_FILE = "./src/ui/frontend-assets.ts";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

async function walkDir(dir: string): Promise<string[]> {
  const results: string[] = [];
  async function scan(d: string) {
    for (const entry of Deno.readDirSync(d)) {
      const full = d + "/" + entry.name;
      if (entry.isDirectory) await scan(full);
      else results.push(full);
    }
  }
  await scan(dir);
  return results;
}

function toBase64(data: Uint8Array): string {
  // 分块处理避免栈溢出
  let binary = "";
  const chunk = 8192;
  for (let i = 0; i < data.length; i += chunk) {
    binary += String.fromCharCode(...data.slice(i, i + chunk));
  }
  return btoa(binary);
}

const files = await walkDir(DIST_DIR);
let entries: string[] = [];

for (const filePath of files) {
  const relativePath = filePath.slice(DIST_DIR.length);
  const data = await Deno.readFile(filePath);
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  const contentType = MIME["." + ext] || "application/octet-stream";
  const base64 = toBase64(data);
  entries.push(`  ${JSON.stringify(relativePath)}: { content: Uint8Array.fromBase64(${JSON.stringify(base64)}), contentType: ${JSON.stringify(contentType)} }`);
}

const output = `// AUTO-GENERATED — 由 deno task gen:frontend 生成
export const FRONTEND_FILES: Record<string, { content: Uint8Array; contentType: string }> = {
${entries.join(",\n")}
};
`;

await Deno.writeTextFile(OUT_FILE, output);
console.log(`[gen:frontend] ${entries.length} files`);
