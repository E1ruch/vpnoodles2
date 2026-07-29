import type { ReactNode } from 'react';

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="content-header">
      <h1>{title}</h1>
      {children && <div className="content-header-actions">{children}</div>}
    </header>
  );
}
