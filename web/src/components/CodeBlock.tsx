type Props = {
  title: string;
  content: string;
  variant?: 'markdown' | 'json' | 'log' | 'patch' | 'text';
};

export function CodeBlock({ title, content, variant = 'text' }: Props) {
  const rendered = variant === 'json' ? formatJson(content) : content;
  return (
    <section className="code-panel" aria-label={title}>
      <header>
        <h3>{title}</h3>
        <span>{variant}</span>
      </header>
      <pre>{rendered}</pre>
    </section>
  );
}

function formatJson(content: string): string {
  try {
    return JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    return content;
  }
}

