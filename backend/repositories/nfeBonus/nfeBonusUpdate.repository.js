// ╔══════════════════════════════════════════════════════════════════════╗
// ║ nfeBonusUpdate.repository.js — update() do cabeçalho e markReady()   ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { createAuditLog } from '../../repositories/auditLogs/auditLogs.index.js';
import { TB_BONUS } from './nfeBonus.constants.js';
import { normalizeText, normalizePositiveInteger, normalizeUserId } from './nfeBonus.sanitizers.js';
import { withTransaction } from './nfeBonus.utils.js';
import { rowToBonus } from './nfeBonus.mappers.js';
import { ensureTables } from './nfeBonusSchema.repository.js';
import { getCustomerForBonus } from './nfeBonusLookup.repository.js';
import { getById } from './nfeBonusGetById.repository.js';

// ======================================================================
// UPDATE BONUS HEADER
// ======================================================================

export async function update(
  bonusId,
  patch = {},
  {
    userId = null,
    operation = 'UPDATE',
  } = {}
) {
  await ensureTables();

  const id =
    normalizePositiveInteger(bonusId);

  if (!id) {
    return {
      ok: false,
      error: 'bonus_id inválido',
    };
  }


  // ------------------------------------------------------------------
  // FIELDS
  // ------------------------------------------------------------------

  const allowed = {
    customer_id:
      patch.customer_id,

    observations:
      patch.observations,

    status:
      patch.status,

    invoice_id:
      patch.invoice_id,
  };


  const sets = [];
  const args = [];

  let ai = 1;


  for (
    const [key, rawValue]
    of Object.entries(allowed)
  ) {

    if (rawValue === undefined) {
      continue;
    }


    let value = rawValue;


    if (key === 'customer_id') {
      value =
        normalizePositiveInteger(rawValue);

      if (!value) {
        return {
          ok: false,
          error:
            'customer_id inválido',
        };
      }
    }


    if (key === 'invoice_id') {
      value =
        rawValue === null
          ? null
          : normalizePositiveInteger(
              rawValue
            );

      if (
        rawValue !== null &&
        !value
      ) {
        return {
          ok: false,
          error:
            'invoice_id inválido',
        };
      }
    }


    if (key === 'observations') {
      value =
        normalizeText(rawValue);
    }


    if (key === 'status') {
      value =
        String(rawValue || '')
          .trim()
          .toUpperCase();

      const validStatuses = new Set([
        'DRAFT',
        'READY',
        'PROCESSING',
        'AUTHORIZED',
        'REJECTED',
        'CANCELLED',
      ]);

      if (
        !validStatuses.has(value)
      ) {
        return {
          ok: false,
          error:
            `Status inválido: ${value}`,
        };
      }
    }


    sets.push(
      `${key} = $${ai++}`
    );

    args.push(value);
  }


  if (!sets.length) {
    return {
      ok: false,
      error:
        'Nenhum campo para atualizar',
    };
  }


  args.push(id);


  // ------------------------------------------------------------------
  // TRANSACTION
  // ------------------------------------------------------------------

  const result =
    await withTransaction(
      async (client) => {

        const beforeRes =
          await client.query(
            `
            SELECT *
            FROM ${TB_BONUS}
            WHERE bonus_id = $1
            FOR UPDATE
            `,
            [id]
          );


        if (!beforeRes.rows.length) {
          return null;
        }


        const current =
          beforeRes.rows[0];


        // Don't edit an already issued bonus
        if (
          ['AUTHORIZED', 'CANCELLED']
            .includes(
              String(current.status)
                .toUpperCase()
            )
        ) {
          throw new Error(
            `Bonificação ${id} não pode ser alterada no status ${current.status}`
          );
        }


        // Validate customer if changing customer
        if (
          patch.customer_id !== undefined
        ) {
          const customer =
            await getCustomerForBonus(
              patch.customer_id,
              {
                db: client,
              }
            );

          if (!customer) {
            throw new Error(
              'Cliente não encontrado'
            );
          }
        }


        const { rows } =
          await client.query(
            `
            UPDATE ${TB_BONUS}
            SET
              ${sets.join(', ')},
              updated_at = NOW()
            WHERE bonus_id = $${ai}
            RETURNING *
            `,
            args
          );


        const after =
          rows[0];


        await createAuditLog({
          tabela: 'nfeBonus',
          register_id: id,

          operation:
            String(
              operation || 'UPDATE'
            ).toUpperCase(),

          user_id:
            normalizeUserId(userId),

          before:
            rowToBonus(
              beforeRes.rows[0]
            ),

          after:
            rowToBonus(after),

          db: client,
        });


        return after;
      }
    );


  if (!result) {
    return {
      ok: false,
      error: 'NOT_FOUND',
    };
  }


  return getById(id);
}



// ======================================================================
// MARK READY
// ======================================================================

export async function markReady(
  bonusId,
  {
    userId = null,
  } = {}
) {
  await ensureTables();

  const id =
    normalizePositiveInteger(
      bonusId
    );


  if (!id) {
    return {
      ok: false,
      error:
        'bonus_id inválido',
    };
  }


  const current =
    await getById(id);


  if (!current.ok) {
    return current;
  }


  if (
    !Array.isArray(
      current.items
    ) ||
    current.items.length === 0
  ) {
    return {
      ok: false,
      error:
        'A bonificação precisa possuir pelo menos um item',
    };
  }


  return update(
    id,
    {
      status: 'READY',
    },
    {
      userId,
      operation:
        'MARK_READY',
    }
  );
}
