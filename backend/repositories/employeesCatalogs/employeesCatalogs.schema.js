// ╔══════════════════════════════════════════════════════════════════════╗
// ║ employeesCatalogs.schema.js — Departamentos e Cargos (idempotente)   ║
// ║ Tabelas: public."employeesDepartments", public."employeesPositions" ║
// ║ Vínculo: employees.employee_department_id / employee_position_id    ║
// ║ Migração: os textos já digitados em employees.department/position   ║
// ║ viram registros e os colaboradores são vinculados a eles.           ║
// ╚══════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';
import { ensureTable as ensureEmployeesTable } from '../employees/employeesSchema.repository.js';

export const TB_DEPARTMENTS = 'public."employeesDepartments"';
export const PK_DEPARTMENTS = 'employee_department_id';
export const TB_POSITIONS = 'public."employeesPositions"';
export const PK_POSITIONS = 'employee_position_id';
export const TB_EMPLOYEES = 'public.employees';

let _ensurePromise = null;

export function ensureCatalogs() {
  if (_ensurePromise) return _ensurePromise;

  _ensurePromise = (async () => {
    // employees precisa existir (e ter as colunas *_id) antes da migração
    await ensureEmployeesTable();

    const client = await pool.connect();
    const LOCK_KEY = 'consart.ensureTable.employeesCatalogs';

    try {
      await client.query(`SET lock_timeout TO '5s'`);
      await client.query(`SELECT pg_advisory_lock(hashtext($1)::bigint)`, [LOCK_KEY]);
      await client.query('BEGIN');

      await client.query(`
        CREATE TABLE IF NOT EXISTS ${TB_DEPARTMENTS} (
          ${PK_DEPARTMENTS} SERIAL PRIMARY KEY,
          name              VARCHAR(100) NOT NULL,
          description       TEXT,
          active            BOOLEAN NOT NULL DEFAULT TRUE,
          created_at        TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_at        TIMESTAMP NOT NULL DEFAULT NOW()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_departments_name_unique
          ON ${TB_DEPARTMENTS} (LOWER(TRIM(name)));

        CREATE TABLE IF NOT EXISTS ${TB_POSITIONS} (
          ${PK_POSITIONS}   SERIAL PRIMARY KEY,
          name              VARCHAR(100) NOT NULL,
          ${PK_DEPARTMENTS} INTEGER REFERENCES ${TB_DEPARTMENTS}(${PK_DEPARTMENTS})
                              ON UPDATE CASCADE ON DELETE SET NULL,
          description       TEXT,
          active            BOOLEAN NOT NULL DEFAULT TRUE,
          created_at        TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_at        TIMESTAMP NOT NULL DEFAULT NOW()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_positions_name_unique
          ON ${TB_POSITIONS} (LOWER(TRIM(name)));

        CREATE INDEX IF NOT EXISTS idx_employees_department_id ON ${TB_EMPLOYEES} (${PK_DEPARTMENTS});
        CREATE INDEX IF NOT EXISTS idx_employees_position_id ON ${TB_EMPLOYEES} (${PK_POSITIONS});
      `);

      // ── Migração dos textos livres (roda sempre, mas só age no que falta) ──
      await client.query(`
        INSERT INTO ${TB_DEPARTMENTS} (name)
        SELECT MIN(TRIM(e.department))
        FROM ${TB_EMPLOYEES} e
        WHERE e.${PK_DEPARTMENTS} IS NULL AND COALESCE(TRIM(e.department), '') <> ''
        GROUP BY LOWER(TRIM(e.department))
        ON CONFLICT DO NOTHING;

        UPDATE ${TB_EMPLOYEES} e
        SET ${PK_DEPARTMENTS} = d.${PK_DEPARTMENTS}
        FROM ${TB_DEPARTMENTS} d
        WHERE e.${PK_DEPARTMENTS} IS NULL
          AND LOWER(TRIM(e.department)) = LOWER(TRIM(d.name));

        INSERT INTO ${TB_POSITIONS} (name)
        SELECT MIN(TRIM(e.position))
        FROM ${TB_EMPLOYEES} e
        WHERE e.${PK_POSITIONS} IS NULL AND COALESCE(TRIM(e.position), '') <> ''
        GROUP BY LOWER(TRIM(e.position))
        ON CONFLICT DO NOTHING;

        UPDATE ${TB_EMPLOYEES} e
        SET ${PK_POSITIONS} = p.${PK_POSITIONS}
        FROM ${TB_POSITIONS} p
        WHERE e.${PK_POSITIONS} IS NULL
          AND LOWER(TRIM(e.position)) = LOWER(TRIM(p.name));

        -- texto igual ao do cadastro (ex.: "gestor" vinculado a "Gestor")
        UPDATE ${TB_EMPLOYEES} e SET department = d.name
        FROM ${TB_DEPARTMENTS} d
        WHERE e.${PK_DEPARTMENTS} = d.${PK_DEPARTMENTS} AND e.department IS DISTINCT FROM d.name;

        UPDATE ${TB_EMPLOYEES} e SET position = p.name
        FROM ${TB_POSITIONS} p
        WHERE e.${PK_POSITIONS} = p.${PK_POSITIONS} AND e.position IS DISTINCT FROM p.name;
      `);

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      _ensurePromise = null;
      throw error;
    } finally {
      await client.query(`SELECT pg_advisory_unlock(hashtext($1)::bigint)`, [LOCK_KEY]).catch(() => {});
      client.release();
    }
  })();

  return _ensurePromise;
}
