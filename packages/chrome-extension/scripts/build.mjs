import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(packageRoot, "../..");
const output = path.join(packageRoot, "dist");
const source = path.join(packageRoot, "src");
const files = [
  "content-script.js",
  "gitlab-url.js",
  "popup.css",
  "popup.html",
  "popup.js",
  "service-worker.js",
];

await rm(output, { recursive: true, force: true });
await mkdir(path.join(output, "icons"), { recursive: true });
for (const file of files) await cp(path.join(source, file), path.join(output, file));

const manifest = JSON.parse(await readFile(path.join(packageRoot, "manifest.json"), "utf8"));
await writeFile(path.join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
await cp(
  path.join(repositoryRoot, "packages/desktop/assets/icon.png"),
  path.join(output, "icons/icon.png"),
);

console.log(`Built unpacked extension at ${output}`);
