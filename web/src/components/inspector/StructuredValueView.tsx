export function StructuredValueView({ value }: { value: unknown }) {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return <pre className="selection-readable-text">{String(value) || 'empty'}</pre>;
  }
  if (value === null || value === undefined) {
    return <p className="selection-readable-empty">empty</p>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <p className="selection-readable-empty">empty array</p>;
    }
    return (
      <ol className="selection-readable-list">
        {value.map((item, index) => (
          <li key={`item-${index}`}>
            <StructuredValueView value={item} />
          </li>
        ))}
      </ol>
    );
  }
  if (isStructuredRecord(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return <p className="selection-readable-empty">empty object</p>;
    }
    return (
      <dl className="selection-readable-fields">
        {entries.map(([key, item]) => (
          <div key={key}>
            <dt>{key}</dt>
            <dd>
              <StructuredValueView value={item} />
            </dd>
          </div>
        ))}
      </dl>
    );
  }
  return <pre className="selection-readable-text">{String(value)}</pre>;
}

function isStructuredRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
