import { readFile } from "node:fs/promises";
import { resolve, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import type { Blueprint, ModuleHandler, Contract } from "@make-testkit/engine";

/** Accept a blueprint as inline JSON, a JSON string, or a filesystem path. */
export async function loadBlueprint(input: string | object): Promise<Blueprint> {
  if (input && typeof input === "object") return input as Blueprint;
  const text = String(input).trim();
  if (text.startsWith("{")) return JSON.parse(text) as Blueprint;
  const abs = isAbsolute(text) ? text : resolve(process.cwd(), text);
  return JSON.parse(await readFile(abs, "utf8")) as Blueprint;
}

/**
 * Dynamically import a user module and resolve an export to a value.
 * Tries `named`, then `default` (calling it if it's a factory function).
 */
export async function loadExport<T>(modulePath: string, named: string): Promise<T> {
  const abs = isAbsolute(modulePath) ? modulePath : resolve(process.cwd(), modulePath);
  const mod = (await import(pathToFileURL(abs).href)) as Record<string, unknown>;
  const picked = mod[named] ?? mod.default;
  return (typeof picked === "function" && named !== "default" ? picked : picked) as T;
}

export async function loadHandlers(modulePath?: string): Promise<Record<string, ModuleHandler> | undefined> {
  if (!modulePath) return undefined;
  const v = await loadExport<unknown>(modulePath, "handlers");
  return (typeof v === "function" ? (v as () => Record<string, ModuleHandler>)() : v) as Record<string, ModuleHandler>;
}

/**
 * Seed state from a handlers module: calls its `makeState`/`createState`
 * factory if present, else uses a `state` export, else an empty object.
 */
export async function loadState(modulePath?: string): Promise<unknown> {
  if (!modulePath) return {};
  const abs = isAbsolute(modulePath) ? modulePath : resolve(process.cwd(), modulePath);
  const mod = (await import(pathToFileURL(abs).href)) as Record<string, unknown>;
  const factory = mod.makeState ?? mod.createState;
  if (typeof factory === "function") return (factory as () => unknown)();
  return mod.state ?? {};
}

export async function loadContracts(modulePath?: string): Promise<Contract[] | undefined> {
  if (!modulePath) return undefined;
  const v = await loadExport<unknown>(modulePath, "contracts");
  return (typeof v === "function" ? (v as () => Contract[])() : v) as Contract[];
}

/** Wrap a JSON-able value as an MCP text content result. */
export function jsonResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

export function errorResult(message: string) {
  return { isError: true, content: [{ type: "text" as const, text: message }] };
}
