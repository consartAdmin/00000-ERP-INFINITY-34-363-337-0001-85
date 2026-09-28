// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ shortCutsProgramationApi.js — Service DB Access                         ║
// ║ Table: public."shortCutsProgramation"                                  ║
// ║ ✅ Supports category_id / subcategory_id                                ║
// ║ ✅ Keeps legacy category / subcategory text fields                       ║
// ║ ✅ Auto-creates category/subcategory tables                              ║
// ║ ✅ List with JOIN names for selects/filter                               ║
// ╚══════════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

export const TB = 'public."shortCutsProgramation"';
export const TB_CATEGORIES = 'public."shortCutsCategories"';
export const TB_SUBCATEGORIES = 'public."shortCutsSubCategories"';

const toStrOrNull = (v) => (v === '' || v == null ? null : String(v));

const toBool = (v, def = true) => {
    if (v === '' || v == null) return def;
    if (typeof v === 'boolean') return v;
    return ['true', '1', 'yes', 'y', 'sim', 's'].includes(String(v).toLowerCase());
};

const toInt = (v, def = 0) => {
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) ? n : def;
};

const toBigIntOrNull = (v) => {
    if (v === '' || v == null) return null;
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
};

export async function ensureTable() {
    await pool.query(`
    CREATE TABLE IF NOT EXISTS ${TB_CATEGORIES}
    (
      category_id BIGSERIAL PRIMARY KEY,
      name        VARCHAR(100) NOT NULL UNIQUE,
      description TEXT,
      icon        VARCHAR(100),
      color       VARCHAR(20),
      sort_order  INTEGER DEFAULT 0,
      active      BOOLEAN DEFAULT TRUE,
      created_at  TIMESTAMP DEFAULT NOW(),
      updated_at  TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ${TB_SUBCATEGORIES}
    (
      subcategory_id BIGSERIAL PRIMARY KEY,
      category_id    BIGINT NOT NULL,
      name           VARCHAR(100) NOT NULL,
      description    TEXT,
      sort_order     INTEGER DEFAULT 0,
      active         BOOLEAN DEFAULT TRUE,
      created_at     TIMESTAMP DEFAULT NOW(),
      updated_at     TIMESTAMP DEFAULT NOW(),

      CONSTRAINT fk_shortcuts_subcategory_category
        FOREIGN KEY (category_id)
        REFERENCES public."shortCutsCategories"(category_id)
        ON DELETE CASCADE,

      CONSTRAINT uq_shortcuts_subcategory
        UNIQUE(category_id, name)
    );

    CREATE TABLE IF NOT EXISTS ${TB}
    (
      shortcut_id    BIGSERIAL PRIMARY KEY,

      category       VARCHAR(80),
      subcategory    VARCHAR(80),

      category_id    BIGINT,
      subcategory_id BIGINT,

      title          VARCHAR(200) NOT NULL,
      shortcut_key   VARCHAR(100) UNIQUE NOT NULL,
      shortcut_type  VARCHAR(30),
      language       VARCHAR(30) NOT NULL,
      description    TEXT,
      code           TEXT NOT NULL,
      code_template  TEXT,
      example        TEXT,
      observations   TEXT,
      tags           TEXT,
      difficulty     SMALLINT DEFAULT 1,
      favorite       BOOLEAN DEFAULT FALSE,
      active         BOOLEAN DEFAULT TRUE,
      sort_order     INTEGER DEFAULT 0,
      created_at     TIMESTAMP DEFAULT NOW(),
      updated_at     TIMESTAMP DEFAULT NOW()
    );

    ALTER TABLE ${TB}
      ADD COLUMN IF NOT EXISTS category VARCHAR(80);

    ALTER TABLE ${TB}
      ADD COLUMN IF NOT EXISTS subcategory VARCHAR(80);

    ALTER TABLE ${TB}
      ADD COLUMN IF NOT EXISTS category_id BIGINT;

    ALTER TABLE ${TB}
      ADD COLUMN IF NOT EXISTS subcategory_id BIGINT;

    ALTER TABLE ${TB}
      ADD COLUMN IF NOT EXISTS shortcut_type VARCHAR(30);

    ALTER TABLE ${TB}
      ADD COLUMN IF NOT EXISTS code_template TEXT;

    CREATE INDEX IF NOT EXISTS idx_shortcuts_categories_active
      ON ${TB_CATEGORIES}(active);

    CREATE INDEX IF NOT EXISTS idx_shortcuts_categories_name
      ON ${TB_CATEGORIES}(name);

    CREATE INDEX IF NOT EXISTS idx_shortcuts_subcategories_category
      ON ${TB_SUBCATEGORIES}(category_id);

    CREATE INDEX IF NOT EXISTS idx_shortcuts_subcategories_active
      ON ${TB_SUBCATEGORIES}(active);

    CREATE INDEX IF NOT EXISTS idx_shortcuts_programation_category
      ON ${TB}(category);

    CREATE INDEX IF NOT EXISTS idx_shortcuts_programation_category_id
      ON ${TB}(category_id);

    CREATE INDEX IF NOT EXISTS idx_shortcuts_programation_subcategory_id
      ON ${TB}(subcategory_id);

    CREATE INDEX IF NOT EXISTS idx_shortcuts_programation_language
      ON ${TB}(language);

    CREATE INDEX IF NOT EXISTS idx_shortcuts_programation_key
      ON ${TB}(shortcut_key);

    CREATE INDEX IF NOT EXISTS idx_shortcuts_programation_active
      ON ${TB}(active);
  `);

    await addForeignKeyIfNotExists({
        tableName: 'shortCutsProgramation',
        constraintName: 'fk_shortcuts_programation_category',
        sql: `
      ALTER TABLE ${TB}
      ADD CONSTRAINT fk_shortcuts_programation_category
      FOREIGN KEY (category_id)
      REFERENCES public."shortCutsCategories"(category_id)
    `,
    });

    await addForeignKeyIfNotExists({
        tableName: 'shortCutsProgramation',
        constraintName: 'fk_shortcuts_programation_subcategory',
        sql: `
      ALTER TABLE ${TB}
      ADD CONSTRAINT fk_shortcuts_programation_subcategory
      FOREIGN KEY (subcategory_id)
      REFERENCES public."shortCutsSubCategories"(subcategory_id)
    `,
    });
}

async function addForeignKeyIfNotExists({ tableName, constraintName, sql }) {
    const exists = await pool.query(
        `
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = $1
      AND c.conname = $2
    LIMIT 1
    `,
        [tableName, constraintName]
    );

    if (!exists.rowCount) {
        await pool.query(sql);
    }
}

function normalizePayload(body = {}) {
    return {
        category_id: toBigIntOrNull(body.category_id),
        subcategory_id: toBigIntOrNull(body.subcategory_id),

        category: toStrOrNull(body.category),
        subcategory: toStrOrNull(body.subcategory),

        title: toStrOrNull(body.title),
        shortcut_key: toStrOrNull(body.shortcut_key),
        shortcut_type: toStrOrNull(body.shortcut_type),
        language: toStrOrNull(body.language),
        description: toStrOrNull(body.description),
        code: toStrOrNull(body.code),
        code_template: toStrOrNull(body.code_template),
        example: toStrOrNull(body.example),
        observations: toStrOrNull(body.observations),
        tags: toStrOrNull(body.tags),
        difficulty: toInt(body.difficulty, 1),
        favorite: toBool(body.favorite, false),
        active: toBool(body.active, true),
        sort_order: toInt(body.sort_order, 0),
    };
}

async function hydrateCategoryText(p) {
    if (p.category_id) {
        const cat = await pool.query(
            `SELECT name FROM ${TB_CATEGORIES} WHERE category_id = $1`,
            [p.category_id]
        );

        p.category = cat.rows[0]?.name || p.category;
    }

    if (p.subcategory_id) {
        const sub = await pool.query(
            `SELECT name FROM ${TB_SUBCATEGORIES} WHERE subcategory_id = $1`,
            [p.subcategory_id]
        );

        p.subcategory = sub.rows[0]?.name || p.subcategory;
    }

    return p;
}

export async function list(params = {}) {
    await ensureTable();

    const page = Math.max(toInt(params.page, 1), 1);
    const limit = Math.min(Math.max(toInt(params.limit, 50), 1), 200);
    const offset = (page - 1) * limit;

    const q = toStrOrNull(params.q);
    const category = toStrOrNull(params.category);
    const language = toStrOrNull(params.language);
    const categoryId = toBigIntOrNull(params.category_id);
    const subcategoryId = toBigIntOrNull(params.subcategory_id);
    const active = params.active === undefined || params.active === ''
        ? null
        : toBool(params.active, true);

    const where = [];
    const values = [];

    if (q) {
        values.push(`%${q}%`);
        where.push(`(
      sc.title ILIKE $${values.length}
      OR sc.shortcut_key ILIKE $${values.length}
      OR sc.category ILIKE $${values.length}
      OR sc.subcategory ILIKE $${values.length}
      OR cat.name ILIKE $${values.length}
      OR sub.name ILIKE $${values.length}
      OR sc.language ILIKE $${values.length}
      OR sc.tags ILIKE $${values.length}
      OR sc.description ILIKE $${values.length}
      OR sc.code ILIKE $${values.length}
    )`);
    }

    if (category) {
        values.push(category.trim());
        where.push(`TRIM(category) ILIKE TRIM($${values.length})`);
    }

    if (categoryId) {
        values.push(categoryId);
        where.push(`sc.category_id = $${values.length}`);
    }

    if (subcategoryId) {
        values.push(subcategoryId);
        where.push(`sc.subcategory_id = $${values.length}`);
    }

    if (language) {
        values.push(language);
        where.push(`sc.language = $${values.length}`);
    }

    if (active !== null) {
        values.push(active);
        where.push(`sc.active = $${values.length}`);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const totalSql = `
    SELECT COUNT(*)::int AS total
    FROM ${TB} sc
    LEFT JOIN ${TB_CATEGORIES} cat ON cat.category_id = sc.category_id
    LEFT JOIN ${TB_SUBCATEGORIES} sub ON sub.subcategory_id = sc.subcategory_id
    ${whereSql}
  `;

    const totalResult = await pool.query(totalSql, values);

    values.push(limit, offset);

    const rowsSql = `
    SELECT
      sc.*,
      COALESCE(cat.name, sc.category) AS category_name,
      COALESCE(sub.name, sc.subcategory) AS subcategory_name
    FROM ${TB} sc
    LEFT JOIN ${TB_CATEGORIES} cat ON cat.category_id = sc.category_id
    LEFT JOIN ${TB_SUBCATEGORIES} sub ON sub.subcategory_id = sc.subcategory_id
    ${whereSql}
    ORDER BY sc.favorite DESC, sc.sort_order ASC, sc.shortcut_id DESC
    LIMIT $${values.length - 1}
    OFFSET $${values.length}
  `;

    const rowsResult = await pool.query(rowsSql, values);

    return {
        rows: rowsResult.rows,
        total: totalResult.rows[0]?.total || 0,
        page,
        limit,
    };
}

export async function getById(id) {
    await ensureTable();

    const result = await pool.query(
        `
    SELECT
      sc.*,
      COALESCE(cat.name, sc.category) AS category_name,
      COALESCE(sub.name, sc.subcategory) AS subcategory_name
    FROM ${TB} sc
    LEFT JOIN ${TB_CATEGORIES} cat ON cat.category_id = sc.category_id
    LEFT JOIN ${TB_SUBCATEGORIES} sub ON sub.subcategory_id = sc.subcategory_id
    WHERE sc.shortcut_id = $1
    `,
        [id]
    );

    return result.rows[0] || null;
}

export async function create(body) {
    await ensureTable();

    const p = await hydrateCategoryText(normalizePayload(body));

    if (!p.category_id && !p.category) throw new Error('category or category_id is required');
    if (!p.title) throw new Error('title is required');
    if (!p.shortcut_key) throw new Error('shortcut_key is required');
    if (!p.language) throw new Error('language is required');
    if (!p.code) throw new Error('code is required');

    const result = await pool.query(
        `
    INSERT INTO ${TB}
    (
      category_id, subcategory_id,
      category, subcategory,
      title, shortcut_key, shortcut_type,
      language, description, code, code_template, example,
      observations, tags, difficulty, favorite, active, sort_order
    )
    VALUES
    (
      $1,$2,
      $3,$4,
      $5,$6,$7,
      $8,$9,$10,$11,$12,
      $13,$14,$15,$16,$17,$18
    )
    RETURNING *
    `,
        [
            p.category_id,
            p.subcategory_id,
            p.category,
            p.subcategory,
            p.title,
            p.shortcut_key,
            p.shortcut_type,
            p.language,
            p.description,
            p.code,
            p.code_template,
            p.example,
            p.observations,
            p.tags,
            p.difficulty,
            p.favorite,
            p.active,
            p.sort_order,
        ]
    );

    return result.rows[0];
}

export async function update(id, body) {
    await ensureTable();

    const p = await hydrateCategoryText(normalizePayload(body));

    if (!p.category_id && !p.category) throw new Error('category or category_id is required');
    if (!p.title) throw new Error('title is required');
    if (!p.shortcut_key) throw new Error('shortcut_key is required');
    if (!p.language) throw new Error('language is required');
    if (!p.code) throw new Error('code is required');

    const result = await pool.query(
        `
    UPDATE ${TB}
    SET
      category_id = $1,
      subcategory_id = $2,
      category = $3,
      subcategory = $4,
      title = $5,
      shortcut_key = $6,
      shortcut_type = $7,
      language = $8,
      description = $9,
      code = $10,
      code_template = $11,
      example = $12,
      observations = $13,
      tags = $14,
      difficulty = $15,
      favorite = $16,
      active = $17,
      sort_order = $18,
      updated_at = NOW()
    WHERE shortcut_id = $19
    RETURNING *
    `,
        [
            p.category_id,
            p.subcategory_id,
            p.category,
            p.subcategory,
            p.title,
            p.shortcut_key,
            p.shortcut_type,
            p.language,
            p.description,
            p.code,
            p.code_template,
            p.example,
            p.observations,
            p.tags,
            p.difficulty,
            p.favorite,
            p.active,
            p.sort_order,
            id,
        ]
    );

    return result.rows[0] || null;
}

export async function remove(id) {
    await ensureTable();

    const result = await pool.query(
        `
    UPDATE ${TB}
    SET active = FALSE, updated_at = NOW()
    WHERE shortcut_id = $1
    RETURNING *
    `,
        [id]
    );

    return result.rows[0] || null;
}

export async function restore(id) {
    await ensureTable();

    const result = await pool.query(
        `
    UPDATE ${TB}
    SET active = TRUE, updated_at = NOW()
    WHERE shortcut_id = $1
    RETURNING *
    `,
        [id]
    );

    return result.rows[0] || null;
}

export async function listCategories(params = {}) {
    await ensureTable();

    const active = params.active === undefined || params.active === ''
        ? true
        : toBool(params.active, true);

    const result = await pool.query(
        `
    SELECT *
    FROM ${TB_CATEGORIES}
    WHERE active = $1
    ORDER BY sort_order ASC, name ASC
    `,
        [active]
    );

    return result.rows;
}

export async function listSubCategories(params = {}) {
    await ensureTable();

    const categoryId = toBigIntOrNull(params.category_id);
    const active = params.active === undefined || params.active === ''
        ? true
        : toBool(params.active, true);

    const values = [active];
    const where = ['active = $1'];

    if (categoryId) {
        values.push(categoryId);
        where.push(`category_id = $${values.length}`);
    }

    const result = await pool.query(
        `
    SELECT *
    FROM ${TB_SUBCATEGORIES}
    WHERE ${where.join(' AND ')}
    ORDER BY sort_order ASC, name ASC
    `,
        values
    );

    return result.rows;
}

function normalizeCategoryPayload(body = {}) {
    return {
        name: toStrOrNull(body.name),
        description: toStrOrNull(body.description),
        icon: toStrOrNull(body.icon),
        color: toStrOrNull(body.color),
        sort_order: toInt(body.sort_order, 0),
        active: toBool(body.active, true),
    };
}

function normalizeSubCategoryPayload(body = {}) {
    return {
        category_id: toBigIntOrNull(body.category_id),
        name: toStrOrNull(body.name),
        description: toStrOrNull(body.description),
        sort_order: toInt(body.sort_order, 0),
        active: toBool(body.active, true),
    };
}

export async function createCategory(body) {
    await ensureTable();

    const p = normalizeCategoryPayload(body);

    if (!p.name) throw new Error('name is required');

    const result = await pool.query(
        `
        INSERT INTO ${TB_CATEGORIES}
        (
            name,
            description,
            icon,
            color,
            sort_order,
            active
        )
        VALUES
        (
            $1, $2, $3, $4, $5, $6
        )
        RETURNING *
        `,
        [
            p.name,
            p.description,
            p.icon,
            p.color,
            p.sort_order,
            p.active,
        ]
    );

    return result.rows[0];
}

export async function updateCategory(id, body) {
    await ensureTable();

    const p = normalizeCategoryPayload(body);

    if (!p.name) throw new Error('name is required');

    const result = await pool.query(
        `
        UPDATE ${TB_CATEGORIES}
        SET
            name = $1,
            description = $2,
            icon = $3,
            color = $4,
            sort_order = $5,
            active = $6,
            updated_at = NOW()
        WHERE category_id = $7
        RETURNING *
        `,
        [
            p.name,
            p.description,
            p.icon,
            p.color,
            p.sort_order,
            p.active,
            id,
        ]
    );

    return result.rows[0] || null;
}

export async function removeCategory(id) {
    await ensureTable();

    const result = await pool.query(
        `
        UPDATE ${TB_CATEGORIES}
        SET active = FALSE,
            updated_at = NOW()
        WHERE category_id = $1
        RETURNING *
        `,
        [id]
    );

    return result.rows[0] || null;
}

export async function createSubCategory(body) {
    await ensureTable();

    const p = normalizeSubCategoryPayload(body);

    if (!p.category_id) throw new Error('category_id is required');
    if (!p.name) throw new Error('name is required');

    const result = await pool.query(
        `
        INSERT INTO ${TB_SUBCATEGORIES}
        (
            category_id,
            name,
            description,
            sort_order,
            active
        )
        VALUES
        (
            $1, $2, $3, $4, $5
        )
        RETURNING *
        `,
        [
            p.category_id,
            p.name,
            p.description,
            p.sort_order,
            p.active,
        ]
    );

    return result.rows[0];
}

export async function updateSubCategory(id, body) {
    await ensureTable();

    const p = normalizeSubCategoryPayload(body);

    if (!p.category_id) throw new Error('category_id is required');
    if (!p.name) throw new Error('name is required');

    const result = await pool.query(
        `
        UPDATE ${TB_SUBCATEGORIES}
        SET
            category_id = $1,
            name = $2,
            description = $3,
            sort_order = $4,
            active = $5,
            updated_at = NOW()
        WHERE subcategory_id = $6
        RETURNING *
        `,
        [
            p.category_id,
            p.name,
            p.description,
            p.sort_order,
            p.active,
            id,
        ]
    );

    return result.rows[0] || null;
}

export async function removeSubCategory(id) {
    await ensureTable();

    const result = await pool.query(
        `
        UPDATE ${TB_SUBCATEGORIES}
        SET active = FALSE,
            updated_at = NOW()
        WHERE subcategory_id = $1
        RETURNING *
        `,
        [id]
    );

    return result.rows[0] || null;
}

export default {
    ensureTable,
    list,
    getById,
    create,
    update,
    remove,
    restore,
    listCategories,
    listSubCategories,

    createCategory,
    updateCategory,
    removeCategory,
    createSubCategory,
    updateSubCategory,
    removeSubCategory,
};