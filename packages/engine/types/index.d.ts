// Type declarations for @make-testkit/engine.

/** A Make bundle: the data object flowing between modules. */
export type Bundle = Record<string, unknown>;
/** Map of module-id (string or number) to its current output bundle. */
export type Bundles = Record<string | number, unknown>;

export interface MakeModule {
  id: number;
  module: string;
  version?: number;
  mapper?: Record<string, unknown>;
  parameters?: Record<string, unknown>;
  filter?: MakeFilter;
  routes?: Array<{ flow: MakeModule[] }>;
  onerror?: MakeModule[];
  [k: string]: unknown;
}

export interface MakeFilter {
  name?: string;
  /** OR groups of ANDed conditions. */
  conditions: Array<Array<{ a?: string; b?: string; o: string }>>;
}

export interface Blueprint {
  name?: string;
  flow?: MakeModule[];
  metadata?: { instant?: boolean; scenario?: { dlq?: boolean; maxErrors?: number; [k: string]: unknown } };
  blueprint?: Blueprint;
  [k: string]: unknown;
}

export interface HandlerArgs {
  mod: MakeModule;
  /** The module's mapper after IML rendering (unless handler.raw is true). */
  mapped: Record<string, unknown>;
  bundles: Bundles;
  ctx: RunContext;
}
export interface ModuleHandler {
  (args: HandlerArgs): unknown | Promise<unknown>;
  /** Receive the un-rendered mapper instead of the IML-rendered one. */
  raw?: boolean;
}

export interface StubArgs {
  bundles: Bundles;
  mod: MakeModule;
  ctx: RunContext;
  render: (template: string) => unknown;
}

export interface RunContext {
  /** Arbitrary user state threaded to handlers (e.g. an in-memory store). */
  state?: unknown;
  /** Module-key -> handler. Merged over the generic builtins. */
  handlers?: Record<string, ModuleHandler>;
  /** Module-id -> stub fn; takes precedence over handlers. */
  stubs?: Record<number, (args: StubArgs) => unknown>;
  /** Bundle returned by trigger modules (webhook/mailhook). */
  trigger?: Bundle;
  /** Seed bundles available before the first module. */
  bundles?: Bundles;
  /** Execution trace (populated by the run). */
  trace?: TraceEntry[];
  [k: string]: unknown;
}

export interface TraceEntry {
  id: number;
  module: string;
  bundles?: number;
  filtered?: boolean;
  error?: string;
  handled?: number;
  [k: string]: unknown;
}

export interface RunResult {
  status: "success" | "warning" | "error";
  error: { moduleId: number; module: string; message: string } | null;
  dlq: Array<{ moduleId: number; module: string; message: string }>;
  trace: TraceEntry[];
  warning: boolean;
}

export interface ScenarioRunner {
  disabled: boolean;
  runs: RunResult[];
  run(ctx?: RunContext): Promise<RunResult>;
}

export interface LintFinding {
  level: "error" | "warning";
  code: string;
  moduleId?: number;
  message: string;
}

export interface Contract {
  id: string;
  /** When set, `assert` receives that module; otherwise the whole blueprint. */
  module?: number;
  assert: (target: MakeModule | Blueprint, bp: Blueprint) => true | string | boolean;
}
export interface ContractResult { id: string; ok: boolean; message?: string }

// --- IML ---
export function render(template: unknown, bundles: Bundles): unknown;
export function renderDeep<T>(value: T, bundles: Bundles): T;
export function truthy(v: unknown): boolean;
export function registerFunction(name: string, fn: (...args: any[]) => unknown): void;

// --- filters / formula ---
export function passesFilter(filter: MakeFilter | undefined, bundles: Bundles): boolean;
export function registerOperator(name: string, fn: (a: unknown, b: unknown) => boolean): void;
export function evalFormula(formula: string, fields: Record<string, unknown>): boolean;

// --- handlers ---
export const builtins: Record<string, ModuleHandler>;

// --- interpreter ---
export function runBlueprint(bp: Blueprint, ctx?: RunContext): Promise<RunResult>;
export function createScenarioRunner(bp: Blueprint): ScenarioRunner;

// --- static analysis ---
export function walkModules(flow: MakeModule[]): Generator<MakeModule>;
export function moduleMap(bp: Blueprint): Map<number, MakeModule>;
export function lintBlueprint(bp: Blueprint): LintFinding[];
export function checkContracts(bp: Blueprint, contracts: Contract[]): { ok: boolean; results: ContractResult[] };
