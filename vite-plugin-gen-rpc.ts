import type { Plugin, ResolvedConfig } from "vite";
import * as ts from "typescript";
import { join } from "node:path";
import fs from "node:fs";
import process from "node:process";
import {
  ClientArgs,
  createClient,
  FetchTransport,
  Transport,
} from "@rspc/client";

// Types
type RPCKind = "query" | "mutation" | "subscription";
type ConfigResolved = ReturnType<typeof resolvedConfig>;

/**
 * Configuration options for the RPC (Remote Procedure Call) system.
 */
interface RPCConfig {
  /**
   * The input file or directory for the RPC definitions.
   */
  input: string;

  /**
   * The output file or directory where the generated RPC code will be saved.
   */
  output: string;

  /**
   * Optional client configuration.
   */
  client?:
    | Omit<ClientArgs, "transport"> & {
        /**
         * The absolute URL to the RPC server e.g. `http://localhost:3000/rpc`. or a path relative to the current origin.
         * Which would mean '/rpc' would be the same as `window.location.origin + '/rpc'`.
         */
        transport?: string;
      };

  /**
   * Optional function configuration.
   */
  func?: {
    /**
     * A record of prefixes for different RPC kinds.
     */
    prefix?: Record<RPCKind, string>;

    /**
     * Whether to apply prefixes only to duplicate function names.
     */
    prefixDuplicatesOnly?: boolean;
  };
}

interface RPCTypeMetadata {
  key: string;
  input?: string;
  importInput: boolean;
  result: string;
}

// Constants
const RPC_METHODS: Record<RPCKind, string> = {
  query: "query",
  mutation: "mutation",
  subscription: "subscription",
};

const RPC_TYPE_KEYS: Record<RPCKind, string> = {
  query: "queries",
  mutation: "mutations",
  subscription: "subscriptions",
};

const DEFAULT_CONFIG = {
  client: {
    transport: "/rspc",
  },
  func: {
    prefix: {
      query: "query",
      mutation: "mutate",
      subscription: "subscribeTo",
    },
    prefixDuplicatesOnly: true,
  },
};

function resolvedConfig(config: RPCConfig) {
  const transportUrl = config.client?.transport || DEFAULT_CONFIG.client.transport;
  const transport = transportUrl.startsWith("/") ? `\`\${window.location.origin}${transportUrl}\`` : `"${transportUrl}"`;
  return {
    ...DEFAULT_CONFIG,
    ...config,
    input: normalizeInputPath(config.input),
    client: { ...DEFAULT_CONFIG.client, ...config.client, transport },
    func: { ...DEFAULT_CONFIG.func, ...config.func },
  };
}

/**
 * Creates a Vite plugin for generating RPC (Remote Procedure Call) code.
 *
 * @param {RPCConfig} config - The configuration object for the RPC plugin.
 * @returns {Plugin} The configured Vite plugin.
 *
 * The plugin performs the following tasks:
 * - Resolves the provided configuration.
 * - Configures Vite with the resolved configuration.
 * - Generates RPC code at the start of the build process.
 * - Handles hot updates by regenerating the RPC code when changes are detected in `config.input`.
 */
export default function createRPCPlugin(config: RPCConfig): Plugin {
  const finalConfig: ConfigResolved = resolvedConfig(config);

  return {
    name: "vite-plugin-rspc",
    buildStart: () => generateRPC(finalConfig),
    handleHotUpdate: ({ file }) => {
      if (file.endsWith("backend-rpc.d.ts")) {
        console.log("Regenerating backend-rpc.ts");
        generateRPC(finalConfig);
      }
    },
  };
}

// Core functionality
function generateRPC(config: ConfigResolved) {
  const { sourceFile, typeChecker } = initializeTypeScript(config.input);
  const rpcs = getAllRPCs(sourceFile!, typeChecker);
  const duplicates = findDuplicateKeys(rpcs);
  const functions = generateAllFunctions(
    config,
    sourceFile!,
    typeChecker,
    duplicates
  );

  writeOutputFile(config.output, generateFileContent(config, functions));
}

function generateAllFunctions(
  config: ConfigResolved,
  sourceFile: ts.SourceFile,
  typeChecker: ts.TypeChecker,
  duplicates: string[]
): string[] {
  return Object.keys(RPC_METHODS).flatMap((kind) =>
    generateFunctionsForKind(
      config,
      sourceFile,
      typeChecker,
      kind as RPCKind,
      duplicates
    )
  );
}

function generateFunctionsForKind(
  config: ConfigResolved,
  sourceFile: ts.SourceFile,
  typeChecker: ts.TypeChecker,
  kind: RPCKind,
  duplicates: string[]
): string[] {
  const functions: string[] = [];

  function visit(node: ts.Node) {
    if (!isProceduresTypeAlias(node)) return;

    const type = typeChecker.getTypeAtLocation(node);
    const property = type.getProperty(RPC_TYPE_KEYS[kind]);
    if (!property) return;

    const propertyType = typeChecker.getTypeOfSymbolAtLocation(property, node);
    if (!propertyType.isUnion()) return;

    propertyType.types.forEach((memberType) => {
      const metadata = extractTypeMetadata(memberType, typeChecker, node);
      const functionName = generateFunctionName(
        metadata.key,
        kind,
        config,
        duplicates
      );
      functions.push(generateFunction(functionName, kind, metadata));
    });
  }

  ts.forEachChild(sourceFile, visit);
  return functions;
}

// ------------- TypeScript Generation -------------

function generateFileContent(
  config: ConfigResolved,
  functions: string[]
): string {
  return `
// Auto-generated file - do not edit
import type * as rpc from '${config.input}';
import { createClient, FetchTransport, type Client } from "@rspc/client";

${createClientFactory(config)}

${functions.join("\n\n")}
`;
}

function generateFunctionName(
  key: string,
  kind: RPCKind,
  config: ConfigResolved,
  duplicates: string[]
): string {
  const prefix = duplicates.includes(key)
    ? config.func?.prefix?.[kind] || ""
    : "";
  return camelCase(prefix + key.split(".").map(capitalize).join(""));
}

function generateFunction(
  name: string,
  kind: RPCKind,
  metadata: RPCTypeMetadata
): string {
  const jsDoc = generateJSDoc(metadata.key, kind, metadata);
  const inputParam = metadata.input
    ? `input: ${metadata.importInput ? "rpc." : ""}${metadata.input}`
    : "";

  return `${jsDoc}
export function ${name}(${inputParam}) {
  return client.${RPC_METHODS[kind]}(["${metadata.key}"${
    inputParam ? ", input" : ""
  }]);
}`;
}

function generateJSDoc(
  key: string,
  kind: RPCKind,
  metadata: RPCTypeMetadata
): string {
  return `
/** 
 * ${kind} RPC call to \`${key}\`
 * ${
   metadata.input
     ? `@param input {${metadata.importInput ? "rpc." : ""}${metadata.input}}`
     : "Takes no input"
 }
 * ${
   metadata.result === "null[]"
     ? "@returns {void}"
     : `@returns {${metadata.result}}`
 }
 */`;
}

// ------------- TypeScript Utilities -------------
function initializeTypeScript(inputPath: string) {
  const program = ts.createProgram([inputPath], {});
  const sourceFile = program.getSourceFile(inputPath);
  if (!sourceFile) throw new Error(`Input file not found: ${inputPath}`);

  return { sourceFile, typeChecker: program.getTypeChecker() };
}

function getAllRPCs(sourceFile: ts.SourceFile, typeChecker: ts.TypeChecker) {
  return {
    queries: extractRPCs(sourceFile, typeChecker, "query"),
    mutations: extractRPCs(sourceFile, typeChecker, "mutation"),
    subscriptions: extractRPCs(sourceFile, typeChecker, "subscription"),
  };
}

function extractRPCs(
  node: ts.Node,
  typeChecker: ts.TypeChecker,
  kind: keyof typeof RPC_TYPE_KEYS
): string[] {
  const rpcKeys: string[] = [];

  function visit(node: ts.Node) {
    if (!isProceduresTypeAlias(node)) return;

    const type = typeChecker.getTypeAtLocation(node);
    const property = type.getProperty(kind);
    if (!property) return;

    const propertyType = typeChecker.getTypeOfSymbolAtLocation(property, node);
    if (!propertyType.isUnion()) return;

    propertyType.types.forEach((memberType) => {
      const keyType = getPropertyType(memberType, "key", typeChecker, node);
      if (keyType?.isStringLiteral()) rpcKeys.push(keyType.value);
    });
  }

  ts.forEachChild(node, visit);
  return rpcKeys;
}

// ------------- Utilities -------------

function normalizeInputPath(input: string): string {
  return input.startsWith("./")
    ? join(process.cwd(), input.slice(1)).replace(/\\/g, "/")
    : input;
}

function createClientFactory(config: ConfigResolved) {
  return `
// Generate Client and Config
const transport = new FetchTransport(${config.client.transport});
const clientConfig = {...${JSON.stringify({...config.client, transport: undefined})}, transport};
export const client = createClient<rpc.Procedures>(clientConfig);`;
}

// function resolveTransport(
//   transport?: string | Transport | (() => Transport)
// ): Transport {
//   if (typeof transport === "string") return new FetchTransport(transport);
//   if (typeof transport === "function") return transport();
//   return transport || DEFAULT_CONFIG.client.transport();
// }

function writeOutputFile(path: string, content: string) {
  console.log("Writing generated RPC functions to:", path);
  fs.writeFileSync(path, content);
}

// Type guard and metadata extraction
function isProceduresTypeAlias(node: ts.Node): node is ts.TypeAliasDeclaration {
  return ts.isTypeAliasDeclaration(node) && node.name.text === "Procedures";
}

function getPropertyType(
  type: ts.Type,
  propertyName: string,
  typeChecker: ts.TypeChecker,
  node: ts.Node
): ts.Type | undefined {
  const property = type.getProperty(propertyName);
  return property
    ? typeChecker.getTypeOfSymbolAtLocation(property, node)
    : undefined;
}

function extractTypeMetadata(
  type: ts.Type,
  typeChecker: ts.TypeChecker,
  node: ts.Node
): RPCTypeMetadata {
  const keyType = getPropertyType(
    type,
    "key",
    typeChecker,
    node
  ) as ts.StringLiteralType;
  const inputType = getPropertyType(type, "input", typeChecker, node);
  const resultType = getPropertyType(type, "result", typeChecker, node);

  const input =
    inputType && !isNeverType(inputType)
      ? getTypeString(inputType, typeChecker)
      : undefined;

  return {
    key: keyType.value,
    input,
    importInput: isCustomType(input),
    result: getTypeString(resultType!, typeChecker),
  };
}

function isNeverType(type: ts.Type): boolean {
  return (type.flags & ts.TypeFlags.Never) !== 0;
}

function isCustomType(type?: string): boolean {
  if (!type) return false;
  const builtInTypes = [
    "string",
    "number",
    "boolean",
    "undefined",
    "null",
    "object",
    "symbol",
    "bigint",
  ];
  return !builtInTypes.includes(type);
}

function getTypeString(type: ts.Type, typeChecker: ts.TypeChecker): string {
  if (type.flags & ts.TypeFlags.StringLiteral)
    return `"${(type as ts.StringLiteralType).value}"`;
  if (type.flags & ts.TypeFlags.NumberLiteral)
    return (type as ts.NumberLiteralType).value.toString();
  if (type.flags & ts.TypeFlags.BooleanLiteral) return "boolean";
  if (type.isUnion())
    return type.types.map((t) => getTypeString(t, typeChecker)).join(" | ");
  return typeChecker.typeToString(type);
}

function findDuplicateKeys(rpcs: Record<string, string[]>): string[] {
  const allKeys = Object.values(rpcs).flat();
  return [
    ...new Set(
      allKeys.filter((key) => allKeys.filter((k) => k === key).length > 1)
    ),
  ];
}

// String utilities
function camelCase(str: string): string {
  return str
    .replace(/(?:^\w|[A-Z]|\b\w)/g, (word, index) =>
      index === 0 ? word.toLowerCase() : word.toUpperCase()
    )
    .replace(/\s+/g, "");
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
