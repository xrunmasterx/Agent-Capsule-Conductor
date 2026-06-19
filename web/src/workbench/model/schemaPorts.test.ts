import { describe, expect, test } from 'vitest';

import { effectiveOutputPortsForNode, outputPortsFromSchema, schemaDerivedOutputFields } from './schemaPorts';

describe('schemaPorts', () => {
  test('ensures main output port when no schema-derived outputs exist', () => {
    expect(outputPortsFromSchema(undefined, [])).toEqual([
      expect.objectContaining({
        id: 'main',
        direction: 'output',
        required: true,
      }),
    ]);
  });

  test('projects first-level outputs schema fields and keeps main as complete output', () => {
    const ports = outputPortsFromSchema(
      {
        type: 'object',
        properties: {
          outputs: {
            type: 'object',
            required: ['summary'],
            properties: {
              summary: { type: 'string', title: 'Summary' },
              evidence: { type: 'array', description: 'Evidence rows' },
              main: { type: 'string' },
            },
          },
        },
      },
      [],
    );

    expect(ports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'main', jsonPath: '/', readonly: true }),
        expect.objectContaining({
          id: 'summary',
          label: 'Summary',
          required: true,
          cardinality: 'one',
          jsonPath: '/outputs/summary',
          readonly: true,
        }),
        expect.objectContaining({
          id: 'evidence',
          required: false,
          cardinality: 'many',
          jsonPath: '/outputs/evidence',
          readonly: true,
        }),
      ]),
    );
  });

  test('effectiveOutputPortsForNode delegates schema projection before stale manual ports', () => {
    const ports = effectiveOutputPortsForNode({
      outputSchema: {
        type: 'object',
        properties: {
          outputs: {
            type: 'object',
            properties: {
              fresh: { type: 'string' },
            },
          },
        },
      },
      outputPorts: [{ id: 'stale', label: 'stale', direction: 'output' }],
    });

    expect(ports.some((port) => port.id === 'fresh')).toBe(true);
    expect(ports.some((port) => port.id === 'stale')).toBe(false);
  });

  test('schemaDerivedOutputFields exposes complete main output and projected fields', () => {
    const fields = schemaDerivedOutputFields({
      type: 'object',
      properties: {
        outputs: {
          type: 'object',
          required: ['score'],
          properties: {
            score: { type: 'number', description: 'Confidence score' },
          },
        },
      },
    });

    expect(fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'main',
          type: 'object',
          required: true,
        }),
        expect.objectContaining({
        name: 'score',
        type: 'number',
        required: true,
        }),
      ]),
    );
  });
});
