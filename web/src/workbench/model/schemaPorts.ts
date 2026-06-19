import type { WorkflowPortView } from '../../types/workbench';

const MAIN_OUTPUT_PORT = 'main';
const OUTPUTS_PROPERTY = 'outputs';
const COMPLEX_SCHEMA_KEYS = ['$ref', '$defs', 'anyOf', 'oneOf', 'allOf'];

type OutputProjection = {
  id: string;
  required: boolean;
  cardinality: string;
  jsonPath: string;
  description?: string;
  title?: string;
  schemaType?: string;
  diagnostic?: string;
};

export function outputPortsFromSchema(
  outputSchema: Record<string, unknown> | undefined,
  fallbackPorts: WorkflowPortView[] | undefined,
): WorkflowPortView[] {
  if (!hasProjectedOutputPorts(outputSchema)) {
    return ensureMainOutputPort(fallbackPorts || []);
  }
  return Object.values(projectOutputPortMetadata(outputSchema, true)).map((projection) => ({
    id: projection.id,
    label: projection.title || projection.id,
    direction: 'output',
    required: projection.required,
    cardinality: projection.cardinality,
    artifactTypes: ['artifact'],
    description: projection.description,
    jsonPath: projection.jsonPath,
    schemaType: projection.schemaType,
    projectionSource: 'output_schema',
    diagnostic: projection.diagnostic,
    readonly: true,
  }));
}

export function effectiveOutputPortsForNode(node: {
  outputSchema?: Record<string, unknown>;
  outputPorts?: WorkflowPortView[];
}): WorkflowPortView[] {
  return outputPortsFromSchema(node.outputSchema, node.outputPorts);
}

export function hasProjectedOutputPorts(outputSchema: Record<string, unknown> | undefined): boolean {
  return Object.keys(projectOutputPortMetadata(outputSchema, false)).length > 0;
}

export function isSchemaDerivedOutputPort(port: WorkflowPortView): boolean {
  return port.projectionSource === 'output_schema';
}

export function outputPortTooltip(port: WorkflowPortView): string {
  const rows = [
    `port id: ${port.id}`,
    port.description ? `description: ${port.description}` : '',
    `type: ${port.schemaType || port.artifactTypes?.join(', ') || 'artifact'}`,
    `required: ${String(Boolean(port.required))}`,
    port.jsonPath ? `json_path: ${port.jsonPath}` : '',
    port.projectionSource ? `projection source: ${port.projectionSource}` : '',
    port.diagnostic ? `diagnostic: ${port.diagnostic}` : '',
  ].filter(Boolean);
  return rows.join('\n');
}

export function schemaDerivedOutputFields(outputSchema: Record<string, unknown> | undefined): Array<{
  name: string;
  type: string;
  required: boolean;
  description: string;
  example?: string;
}> {
  if (!hasProjectedOutputPorts(outputSchema)) {
    return [];
  }
  return Object.values(projectOutputPortMetadata(outputSchema, true)).map((projection) => ({
    name: projection.id,
    type: projection.schemaType || 'artifact',
    required: projection.required,
    description: [
      projection.description || projection.title || '',
      projection.jsonPath ? `json_path: ${projection.jsonPath}` : '',
      projection.diagnostic ? `diagnostic: ${projection.diagnostic}` : '',
    ]
      .filter(Boolean)
      .join(' 路 '),
  }));
}

function projectOutputPortMetadata(
  schema: Record<string, unknown> | undefined,
  includeMain: boolean,
): Record<string, OutputProjection> {
  const ports: Record<string, OutputProjection> = {};
  const diagnostics = schemaDiagnostics(schema);
  if (includeMain) {
    ports[MAIN_OUTPUT_PORT] = {
      id: MAIN_OUTPUT_PORT,
      required: true,
      cardinality: 'one',
      jsonPath: '/',
      description: 'Complete node output',
      schemaType: 'object',
      diagnostic: diagnostics.join('; ') || undefined,
    };
  }

  const outputProperties = outputsProperties(schema);
  if (!outputProperties) {
    return ports;
  }
  const requiredPorts = outputsRequired(schema);
  for (const [id, value] of Object.entries(outputProperties)) {
    if (!id || id === MAIN_OUTPUT_PORT) {
      if (id === MAIN_OUTPUT_PORT && ports[MAIN_OUTPUT_PORT]) {
        ports[MAIN_OUTPUT_PORT] = {
          ...ports[MAIN_OUTPUT_PORT],
          diagnostic: appendDiagnostic(
            ports[MAIN_OUTPUT_PORT].diagnostic,
            'outputs.main is not projected because main means complete output',
          ),
        };
      }
      continue;
    }
    const fieldSchema = isPlainRecord(value) ? value : {};
    const schemaType = schemaTypeOf(fieldSchema);
    ports[id] = {
      id,
      required: requiredPorts.has(id),
      cardinality: schemaType === 'array' ? 'many' : 'one',
      jsonPath: `/outputs/${jsonPointerToken(id)}`,
      description: optionalString(fieldSchema.description),
      title: optionalString(fieldSchema.title),
      schemaType,
      diagnostic: schemaDiagnostics(fieldSchema).join('; ') || undefined,
    };
  }
  return ports;
}

function ensureMainOutputPort(ports: WorkflowPortView[]): WorkflowPortView[] {
  const normalized = ports.length > 0 ? ports : [];
  if (normalized.some((port) => port.id === MAIN_OUTPUT_PORT)) {
    return normalized;
  }
  return [
    {
      id: MAIN_OUTPUT_PORT,
      label: 'main',
      direction: 'output',
      required: true,
      cardinality: 'one',
      artifactTypes: ['artifact'],
    },
    ...normalized,
  ];
}

function objectProperties(schema: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (!isPlainRecord(schema)) {
    return null;
  }
  return isPlainRecord(schema.properties) ? schema.properties : null;
}

function outputsSchema(schema: Record<string, unknown> | undefined): Record<string, unknown> | null {
  const properties = objectProperties(schema);
  if (!properties) {
    return null;
  }
  return isPlainRecord(properties[OUTPUTS_PROPERTY]) ? properties[OUTPUTS_PROPERTY] : null;
}

function outputsProperties(schema: Record<string, unknown> | undefined): Record<string, unknown> | null {
  const outputs = outputsSchema(schema);
  if (!outputs) {
    return null;
  }
  return isPlainRecord(outputs.properties) ? outputs.properties : null;
}

function outputsRequired(schema: Record<string, unknown> | undefined): Set<string> {
  const outputs = outputsSchema(schema);
  if (!outputs || !Array.isArray(outputs.required)) {
    return new Set();
  }
  return new Set(outputs.required.filter((item): item is string => typeof item === 'string'));
}

function schemaTypeOf(schema: Record<string, unknown>): string | undefined {
  const rawType = schema.type;
  if (typeof rawType === 'string') {
    return rawType;
  }
  if (Array.isArray(rawType)) {
    const types = rawType.filter((item): item is string => typeof item === 'string' && item !== 'null');
    if (types.length === 1) {
      return types[0];
    }
    if (types.length > 1) {
      return types.join('|');
    }
  }
  return undefined;
}

function schemaDiagnostics(schema: Record<string, unknown> | undefined): string[] {
  if (!isPlainRecord(schema)) {
    return [];
  }
  const diagnostics = COMPLEX_SCHEMA_KEYS.filter((key) => key in schema).map(
    (key) => `schema contains ${key}; projection uses explicit first-level fields only`,
  );
  if (schema.additionalProperties === true || isPlainRecord(schema.additionalProperties)) {
    diagnostics.push('schema allows dynamic properties; dynamic keys are not projected as ports');
  }
  return diagnostics;
}

function jsonPointerToken(value: string): string {
  return value.replace(/~/gu, '~0').replace(/\//gu, '~1');
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function appendDiagnostic(existing: string | undefined, next: string): string {
  return existing ? `${existing}; ${next}` : next;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
