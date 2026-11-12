import pg, { type ClientConfig } from "pg";

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

const auditPools = new Map<string, pg.Pool>();

export function sscasnAuditPool(url: string): pg.Pool {
  let pool = auditPools.get(url);
  if (!pool) {
    pool = new pg.Pool({
      ...aesenConnection(url),
      max: 2,
      idleTimeoutMillis: 10_000,
      query_timeout: 15_000,
      allowExitOnIdle: true,
    });
    pool.on("error", () => console.error("sscasn_audit_pool_error"));
    auditPools.set(url, pool);
  }
  return pool;
}
