import type { ClientConfig } from "pg";

export function aesenConnection(value: string): ClientConfig {
  const url = new URL(value);
  if (!/^postgres(?:ql)?:$/.test(url.protocol) || !url.hostname || !url.pathname.slice(1)) {
    throw new Error("URL PostgreSQL Aesen tidak valid.");
  }
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 5432,
    database: decodeURIComponent(url.pathname.slice(1)),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    ssl: { rejectUnauthorized: true },
    connectionTimeoutMillis: 5_000,
  };
}
