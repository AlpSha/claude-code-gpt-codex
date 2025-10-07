import { existsSync } from "node:fs";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIST_DIR = process.argv[2]
  ? fileURLToPath(new URL(process.argv[2], import.meta.url))
  : fileURLToPath(new URL("../dist", import.meta.url));

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      files.push(fullPath);
    }
  }
  return files;
}

function resolveWithExtension(filePath, specifier) {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
    return specifier;
  }

  const hashIndex = specifier.indexOf("#", 1);
  const queryIndex = specifier.indexOf("?", 1);
  const endIndex = Math.min(
    hashIndex === -1 ? Infinity : hashIndex,
    queryIndex === -1 ? Infinity : queryIndex,
  );

  const base = endIndex === Infinity ? specifier : specifier.slice(0, endIndex);
  const suffix = endIndex === Infinity ? "" : specifier.slice(endIndex);

  const extension = extname(base);
  if (extension) {
    return specifier;
  }

  const importingDir = dirname(filePath);
  const absoluteBase = join(importingDir, base);
  const fileCandidate = `${absoluteBase}.js`;
  if (existsSync(fileCandidate)) {
    return `${base}.js${suffix}`;
  }

  const indexCandidate = join(absoluteBase, "index.js");
  if (existsSync(indexCandidate)) {
    return `${base}/index.js${suffix}`;
  }

  return specifier;
}

function rewriteImports(source, filePath) {
  let didChange = false;
  const patterns = [
    /(import\s+(?:[^"'()]*?\s+from\s+)?["'])(\.{1,2}\/[^"']+)(["'])/g,
    /(export\s+(?:[^"'()]*?\s+from\s+)?["'])(\.{1,2}\/[^"']+)(["'])/g,
    /(import\(\s*["'])(\.{1,2}\/[^"']+)(["']\s*\))/g,
  ];

  let updated = source;
  for (const pattern of patterns) {
    updated = updated.replace(pattern, (match, prefix, specifier, suffix) => {
      const nextSpecifier = resolveWithExtension(filePath, specifier);
      if (nextSpecifier === specifier) {
        return match;
      }
      didChange = true;
      return `${prefix}${nextSpecifier}${suffix}`;
    });
  }

  return { updated, didChange };
}

async function processFile(path) {
  const contents = await readFile(path, "utf8");
  const { updated, didChange } = rewriteImports(contents, path);
  if (!didChange) {
    return false;
  }
  await writeFile(path, updated, "utf8");
  return true;
}

async function main() {
  try {
    const stats = await stat(DIST_DIR);
    if (!stats.isDirectory()) {
      console.warn(`[fix-esm-extensions] Skipped: ${DIST_DIR} is not a directory.`);
      return;
    }
  } catch (error) {
    if ((error && typeof error === "object" && "code" in error && error.code === "ENOENT") || error?.code === "ENOENT") {
      console.warn(`[fix-esm-extensions] Skipped: ${DIST_DIR} does not exist.`);
      return;
    }
    throw error;
  }

  const files = await walk(DIST_DIR);
  await Promise.all(files.map(processFile));
}

main().catch((error) => {
  console.error("[fix-esm-extensions] Failed to rewrite imports", error);
  process.exitCode = 1;
});
