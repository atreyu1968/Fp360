import { randomBytes } from "node:crypto";
import { sha256 } from "./ubuntu-migration-plan.mjs";

export function identifier(value) {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(value)) throw new Error("Identificador de esquema inválido.");
  return `"${value}"`;
}

export async function catalogHash(client, schema) {
  await client.query(`SET LOCAL search_path TO ${identifier(schema)}, pg_catalog`);
  const queries = [
    `SELECT c.relname, c.relkind, c.relrowsecurity, c.relforcerowsecurity,
      CASE WHEN c.relkind IN ('v','m') THEN pg_get_viewdef(c.oid) ELSE NULL END AS view
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=$1 AND c.relkind IN ('r','p','v','m','S')
      ORDER BY c.relname`,
    `SELECT c.relname, a.attnum, a.attname, format_type(a.atttypid,a.atttypmod) AS type,
      a.attnotnull, a.attidentity, a.attgenerated, pg_get_expr(d.adbin,d.adrelid) AS default
      FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace
      LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE n.nspname=$1 AND a.attnum>0 AND NOT a.attisdropped AND c.relkind IN ('r','p','v','m')
      ORDER BY c.relname,a.attnum`,
    `SELECT c.conname, t.relname, c.contype, pg_get_constraintdef(c.oid) AS definition
      FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
      LEFT JOIN pg_class t ON t.oid=c.conrelid WHERE n.nspname=$1
      ORDER BY t.relname,c.conname`,
    `SELECT c.relname, pg_get_indexdef(i.indexrelid) AS definition
      FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 ORDER BY c.relname`,
    `SELECT t.typname,e.enumsortorder,e.enumlabel FROM pg_type t
      JOIN pg_namespace n ON n.oid=t.typnamespace JOIN pg_enum e ON e.enumtypid=t.oid
      WHERE n.nspname=$1 ORDER BY t.typname,e.enumsortorder`,
    `SELECT sequencename,data_type::text,start_value,min_value,max_value,increment_by,cycle,cache_size
      FROM pg_sequences WHERE schemaname=$1 ORDER BY sequencename`,
    `SELECT c.relname,t.tgname,pg_get_triggerdef(t.oid) AS definition
      FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=$1 AND NOT t.tgisinternal ORDER BY c.relname,t.tgname`,
    `SELECT tablename,policyname,permissive,roles,cmd,qual,with_check
      FROM pg_policies WHERE schemaname=$1 ORDER BY tablename,policyname`,
    `SELECT p.proname, pg_get_functiondef(p.oid) AS definition
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname=$1 AND p.prokind IN ('f','p') ORDER BY p.proname,p.oid::regprocedure::text`,
  ];
  const catalog = [];
  for (const sql of queries) catalog.push((await client.query(sql, [schema])).rows);
  // PostgreSQL deparsers qualify some object references even with search_path.
  const normalized = JSON.stringify(catalog).replaceAll(`"${schema}".`, "").replaceAll(`${schema}.`, "");
  return sha256(normalized);
}

export async function snapshotHash(client, sql, restoreSchema) {
  const shadow = `redfp360_shadow_${randomBytes(12).toString("hex")}`;
  await client.query(`CREATE SCHEMA ${identifier(shadow)}`);
  await client.query(`SET LOCAL search_path TO ${identifier(shadow)}, pg_catalog`);
  // Snapshots are reviewed Drizzle exports with public-qualified references.
  // They contain only schema DDL, never copies of operational data.
  await client.query(sql.replaceAll('"public".', `${identifier(shadow)}.`));
  const hash = await catalogHash(client, shadow);
  await client.query(`DROP SCHEMA ${identifier(shadow)} CASCADE`);
  await client.query(`SET LOCAL search_path TO ${identifier(restoreSchema)}, pg_catalog`);
  return hash;
}
