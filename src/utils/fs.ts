import { mkdir, readFile, writeFile, stat } from "fs/promises";
import { constants, createWriteStream } from "fs";
import { access } from "fs/promises";
import os from "os";
import path from "path";

export function expandHomePath(inputPath: string): string {
  if (!inputPath.startsWith("~")) {
    return inputPath;
  }
  const home = os.homedir();
  if (inputPath === "~") {
    return home;
  }
  return path.join(home, inputPath.slice(2));
}

export async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  const dir = path.dirname(filePath);
  await ensureDir(dir);
  const payload = JSON.stringify(value, null, 2);
  await writeFile(filePath, payload, "utf8");
}

export async function touchFile(filePath: string, contents: string): Promise<void> {
  const dir = path.dirname(filePath);
  await ensureDir(dir);
  await writeFile(filePath, contents, "utf8");
}

export async function getFileMtimeMs(filePath: string): Promise<number | null> {
  try {
    const stats = await stat(filePath);
    return stats.mtimeMs;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export function createFileWriteStream(filePath: string) {
  const dir = path.dirname(filePath);
  void ensureDir(dir);
  return createWriteStream(filePath);
}
