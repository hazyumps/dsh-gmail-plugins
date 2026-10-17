/**
 * Tool definitions for the Gmail plugin.
 *
 * Upstream wrapped `defineTool` from `@deepseek-ai/dsh-tools`. A plugin
 * installed by path resolves no bare dependencies, so that import fails the
 * whole entry at load ("failed to import"). This module reproduces the two
 * things that import bought us:
 *
 *   1. the author-facing parameter shorthand (`{ type: 'string', required }`)
 *      compiled to the JSON Schema the registry stores, and
 *   2. argument validation before the tool body runs.
 *
 * The definition shape itself is DSH 0.2's `tools.register()` contract:
 * `{ name, description, parameters, output: { schema, render }, execute,
 * presentCall }`. `tools.register` still validates the output schema, so a
 * mistake here fails loudly at activation rather than at call time.
 *
 * @module dsh-plugin-gmail/tools
 */

import { GmailError, jsonObjectOutput, presentCall } from './util.js';

const VALUE_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'array', 'object', 'json']);

function schemaError(path, message) {
  return new Error(`gmail: parameter schema at ${path}: ${message}`);
}

/** Compile one author-facing value schema. `json` means unconstrained JSON. */
function compileValue(def, path) {
  if (def === null || typeof def !== 'object' || Array.isArray(def)) {
    throw schemaError(path, 'must be a schema object');
  }
  const type = def.type ?? 'string';
  if (!VALUE_TYPES.has(type)) throw schemaError(path, `unsupported type "${String(type)}"`);

  const schema = {};
  if (def.description !== undefined) {
    if (typeof def.description !== 'string') throw schemaError(path, '"description" must be a string');
    schema.description = def.description;
  }
  if (def.default !== undefined) schema.default = def.default;

  switch (type) {
    case 'json':
      // Annotation-only schema: any JSON value is accepted.
      break;
    case 'object':
      if (typeof def.additionalProperties !== 'boolean') {
        throw schemaError(path, 'object schemas must declare additionalProperties: true|false');
      }
      schema.type = 'object';
      schema.additionalProperties = def.additionalProperties;
      if (def.properties !== undefined) {
        schema.properties = compileParameters(def.properties, `${path}.properties`);
      }
      break;
    case 'array':
      schema.type = 'array';
      if (def.items !== undefined) schema.items = compileValue(def.items, `${path}.items`);
      break;
    default:
      schema.type = type;
  }

  if (def.enum !== undefined) {
    if (!Array.isArray(def.enum) || def.enum.length === 0) throw schemaError(path, '"enum" must be a non-empty array');
    if (!def.enum.every((value) => ['string', 'number', 'boolean'].includes(typeof value))) {
      throw schemaError(path, '"enum" values must be strings, numbers, or booleans');
    }
    schema.enum = [...def.enum];
  }

  return schema;
}

/**
 * Compile the author-facing parameter map into an object-rooted JSON Schema.
 * @param spec - `{ name: { type, description, required, ... } }`.
 * @param path - diagnostic path.
 */
export function compileParameters(spec, path = 'parameters') {
  if (spec === undefined) return { type: 'object', properties: {} };
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
    throw schemaError(path, 'must be an object of parameter definitions');
  }
  const properties = {};
  const required = [];
  for (const [key, definition] of Object.entries(spec)) {
    properties[key] = compileValue(definition, `${path}.${key}`);
    if (definition.required === true) required.push(key);
    else if (definition.required !== undefined) throw schemaError(`${path}.${key}`, '"required" must be true when present');
  }
  return { type: 'object', properties, ...(required.length > 0 ? { required } : {}) };
}

function typeMatches(type, value) {
  switch (type) {
    case 'string': return typeof value === 'string';
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'integer': return Number.isInteger(value);
    case 'boolean': return typeof value === 'boolean';
    case 'array': return Array.isArray(value);
    case 'object': return value !== null && typeof value === 'object' && !Array.isArray(value);
    default: return true;
  }
}

function validateValue(schema, value, path, violations) {
  if (schema.type !== undefined && !typeMatches(schema.type, value)) {
    const article = schema.type === 'array' || schema.type === 'object' || schema.type === 'integer' ? 'an' : 'a';
    violations.push(`${path} must be ${article} ${schema.type}`);
    return;
  }
  if (schema.enum !== undefined && !schema.enum.includes(value)) {
    violations.push(`${path} must be one of ${schema.enum.map((v) => JSON.stringify(v)).join(', ')}`);
  }
  if (schema.type === 'array' && schema.items !== undefined) {
    value.forEach((item, index) => validateValue(schema.items, item, `${path}[${index}]`, violations));
  }
  if (schema.type === 'object') {
    validateObject(schema, value, path, violations);
  }
}

function validateObject(schema, value, path, violations) {
  const properties = schema.properties ?? {};
  for (const key of schema.required ?? []) {
    if (!(key in value)) violations.push(`${path}.${key} is required`);
  }
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(value)) {
      if (!(key in properties)) violations.push(`${path}.${key} is not an allowed property`);
    }
  }
  for (const [key, propertySchema] of Object.entries(properties)) {
    if (key in value) validateValue(propertySchema, value[key], `${path}.${key}`, violations);
  }
}

/**
 * Validate model-supplied arguments against a compiled parameter schema.
 * @returns path-qualified violations; empty means valid.
 */
export function validateArgs(parameters, args) {
  const violations = [];
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    return ['arguments must be an object'];
  }
  validateObject(parameters, args, 'args', violations);
  return violations;
}

function assertOutput(output, name) {
  if (output === null || typeof output !== 'object' || typeof output.render !== 'function') {
    throw new Error(`gmail: tool "${name}" must declare output { schema, render }`);
  }
  if (output.schema === null || typeof output.schema !== 'object') {
    throw new Error(`gmail: tool "${name}" must declare an output schema`);
  }
}

/**
 * Build one registry-ready tool definition.
 * @param spec - { name, description, parameters, execute, title?, kind?, output? }
 */
export function defineTool(spec) {
  const { name, description, parameters, execute, title, kind = 'other', output } = spec;
  if (typeof name !== 'string' || name.length === 0) throw new Error('gmail: tool name must be a non-empty string');
  if (typeof description !== 'string' || description.length === 0) throw new Error(`gmail: tool "${name}" needs a description`);
  if (typeof execute !== 'function') throw new Error(`gmail: tool "${name}" needs an execute function`);

  const compiledParameters = compileParameters(parameters);
  const compiledOutput = output ?? jsonObjectOutput();
  assertOutput(compiledOutput, name);

  return {
    name,
    description,
    parameters: compiledParameters,
    output: compiledOutput,
    async execute(args, exec) {
      const violations = validateArgs(compiledParameters, args);
      if (violations.length > 0) {
        throw new GmailError(`invalid arguments: ${violations.join('; ')}`, 'GMAIL_INVALID_ARGS');
      }
      return execute(args, exec);
    },
    presentCall(args) {
      if (validateArgs(compiledParameters, args).length > 0) return undefined;
      return presentCall(title ?? name, kind, args);
    },
  };
}

/** Register every tool returned by a module's `tools(ctx, deps)` list. */
export function registerTools(ctx, deps, tools) {
  for (const tool of tools) {
    ctx.tools.register(defineTool(tool));
  }
}

/** Resolve the `user_id` argument against the configured default. */
export function userId(args, config) {
  const id = args.user_id ?? args.userId;
  return id === undefined || id === '' ? config.defaultUserId : id;
}
