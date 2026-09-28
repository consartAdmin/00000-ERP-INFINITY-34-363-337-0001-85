// ╔══════════════════════════════════════════════════════════════════════╗
// ║ nfeBonusItemRemove.repository.js — removeItem()                      ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { createAuditLog } from '../../repositories/auditLogs/auditLogs.index.js';
import { TB_BONUS, TB_BONUS_ITEMS } from './nfeBonus.constants.js';
import { normalizePositiveInteger, normalizeUserId } from './nfeBonus.sanitizers.js';
import { withTransaction } from './nfeBonus.utils.js';
import { rowToBonusItem } from './nfeBonus.mappers.js';
import { ensureTables } from './nfeBonusSchema.repository.js';
import { recalculateBonusTotal } from './nfeBonusTotal.repository.js';
import { getById } from './nfeBonusGetById.repository.js';

// ======================================================================
// REMOVE ITEM
// ======================================================================

export async function removeItem(
  bonusId,
  bonusItemId,
  {
    userId = null,
  } = {}
) {
  await ensureTables();

  const safeBonusId =
    normalizePositiveInteger(
      bonusId
    );

  const safeItemId =
    normalizePositiveInteger(
      bonusItemId
    );


  if (!safeBonusId) {
    return {
      ok: false,
      error:
        'bonus_id inválido',
    };
  }


  if (!safeItemId) {
    return {
      ok: false,
      error:
        'bonus_item_id inválido',
    };
  }


  const result =
    await withTransaction(
      async (client) => {

        // ------------------------------------------------------------
        // BONUS
        // ------------------------------------------------------------

        const bonusRes =
          await client.query(
            `
            SELECT *
            FROM ${TB_BONUS}
            WHERE bonus_id = $1
            FOR UPDATE
            `,
            [safeBonusId]
          );


        if (!bonusRes.rows.length) {
          return {
            ok: false,
            error:
              'BONUS_NOT_FOUND',
          };
        }


        if (
          String(
            bonusRes.rows[0].status
          ).toUpperCase() !==
          'DRAFT'
        ) {
          return {
            ok: false,
            error:
              'Itens só podem ser removidos enquanto a bonificação estiver em DRAFT',
          };
        }


        // ------------------------------------------------------------
        // DELETE
        // ------------------------------------------------------------

        const { rows } =
          await client.query(
            `
            DELETE FROM ${TB_BONUS_ITEMS}
            WHERE
              bonus_item_id = $1
              AND bonus_id = $2
            RETURNING *
            `,
            [
              safeItemId,
              safeBonusId,
            ]
          );


        if (!rows.length) {
          return {
            ok: false,
            error:
              'ITEM_NOT_FOUND',
          };
        }


        const deleted =
          rows[0];


        // ------------------------------------------------------------
        // TOTAL
        // ------------------------------------------------------------

        await recalculateBonusTotal(
          safeBonusId,
          {
            db: client,
          }
        );


        // ------------------------------------------------------------
        // AUDIT
        // ------------------------------------------------------------

        await createAuditLog({
          tabela:
            'nfeBonusItems',

          register_id:
            safeItemId,

          operation:
            'DELETE',

          user_id:
            normalizeUserId(userId),

          before:
            rowToBonusItem(
              deleted
            ),

          after:
            null,

          db: client,
        });


        return {
          ok: true,
        };
      }
    );


  if (!result.ok) {
    return result;
  }


  return getById(
    safeBonusId
  );
}
