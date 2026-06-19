import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';

import type { WorkflowPortView } from '../../types/workbench';
import {
  SchemaFieldCards,
  dedupeSchemaFields,
  schemaFieldsFromArtifactContract,
  schemaFieldsFromJsonSchema,
  schemaFieldsFromPorts,
} from './SchemaFieldCards';

describe('SchemaFieldCards', () => {
  test('renders schema field cards and empty state', () => {
    const { rerender } = render(
      <SchemaFieldCards
        title="Input"
        emptyText="No input schema fields declared."
        fields={[
          {
            name: 'target',
            type: 'string',
            required: true,
            description: 'Ticker symbol',
            example: 'AAPL',
          },
        ]}
      />,
    );

    expect(screen.getByText('target')).toBeInTheDocument();
    expect(screen.getByText('string')).toBeInTheDocument();
    expect(screen.getByText('Ticker symbol')).toBeInTheDocument();
    expect(screen.getByText('必填 · 示例：AAPL')).toBeInTheDocument();

    rerender(<SchemaFieldCards title="Output" emptyText="No output schema fields declared." fields={[]} />);
    expect(screen.getByText('No output schema fields declared.')).toBeInTheDocument();
  });

  test('projects fields from JSON schema and artifact contract', () => {
    const fields = schemaFieldsFromJsonSchema({
      required: ['summary'],
      properties: {
        summary: { type: 'string', description: 'Summary text', default: 'ok' },
        score: { type: ['number', 'null'], label: 'Score' },
      },
    });

    expect(fields).toEqual([
      {
        name: 'summary',
        type: 'string',
        required: true,
        description: 'Summary text',
        example: 'ok',
      },
      {
        name: 'score',
        type: 'number / null',
        required: false,
        description: 'Score',
      },
    ]);

    expect(
      schemaFieldsFromArtifactContract({
        output_schema: {
          properties: {
            evidence_pack: { schema: { type: 'object', description: 'Evidence bundle' } },
          },
        },
      }),
    ).toEqual([
      {
        name: 'evidence_pack',
        type: 'object',
        required: false,
        description: 'Evidence bundle',
      },
    ]);
  });

  test('falls back to workflow port metadata and de-duplicates fields', () => {
    const fallbackPorts: WorkflowPortView[] = [
      {
        id: 'verified_data',
        label: 'Verified Data',
        direction: 'input',
        required: true,
        artifactTypes: ['json'],
      },
      {
        id: 'main',
        label: '',
        direction: 'output',
        required: false,
      },
    ];

    expect(schemaFieldsFromPorts(undefined, fallbackPorts)).toEqual([
      {
        name: 'Verified Data',
        type: 'json',
        required: true,
        description: '输入端口: verified_data',
      },
      {
        name: 'main',
        type: '数据',
        required: false,
        description: '输出端口: main',
      },
    ]);

    expect(
      dedupeSchemaFields([
        { name: 'main', type: 'string', required: false, description: '' },
        { name: 'main', type: 'string', required: true, description: 'duplicate' },
        { name: 'main', type: 'json', required: true, description: 'different type' },
      ]),
    ).toEqual([
      { name: 'main', type: 'string', required: false, description: '' },
      { name: 'main', type: 'json', required: true, description: 'different type' },
    ]);
  });
});
