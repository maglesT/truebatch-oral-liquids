import postgres from 'postgres';

export type Sql = postgres.Sql;
export type Tx = postgres.TransactionSql;

export interface ConnectOptions {
  // Run as the restricted application role (no UPDATE/DELETE on audit_log or signatures; PL-06).
  role?: string;
  searchPath?: string;
  // A link to another product: give up quickly when it does not answer (server/links.ts counts it down).
  link?: boolean;
}

export function connect(url: string, { role, searchPath, link }: ConnectOptions = {}): Sql {
  // Sessions run in UTC so timestamps never depend on the server's local zone.
  const options = [role && `-c role=${role}`, searchPath && `-c search_path=${searchPath}`].filter(Boolean).join(' ');
  return postgres(url, {
    connection: { TimeZone: 'UTC', ...(options ? { options } : {}), ...(link ? { statement_timeout: 5000 } : {}) },
    ...(link ? { connect_timeout: 5 } : {}),
    // Small pools that close when idle: every product on the platform shares one database server (max_connections).
    // A link to another product reads a little now and then; the product's own database does the work.
    max: link ? 2 : 5, idle_timeout: 60,
    onnotice: () => {},
  });
}
