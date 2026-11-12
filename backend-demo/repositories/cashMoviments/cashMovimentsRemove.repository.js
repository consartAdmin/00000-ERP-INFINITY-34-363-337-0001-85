// ╔════════════════════════════════════════════════════════════════════╗
// ║ cashMovimentsRemove.repository.js — deleteMovement                 ║
// ║ Tabelas: "cashMoviments" + "cashMovimentsAttachments"              ║
// ║ Ponta de transferência → apaga a transferência inteira             ║
// ╚════════════════════════════════════════════════════════════════════╝

import { q } from './cashMoviments.utils.js';
import { deleteTransfer, transferIdsOfMovements } from './cashTransfers.repository.js';

export async function deleteMovement(id) {
  const [transferId] = await transferIdsOfMovements([id]);
  if (transferId) return !!(await deleteTransfer(transferId));

  await q(
    `DELETE FROM "cashMovimentsAttachments" WHERE cash_movement_id = $1`,
    [Number(id)]
  );

  const res = await q(
    `DELETE FROM "cashMoviments" WHERE id = $1 RETURNING id`,
    [Number(id)]
  );

  return res.rowCount > 0;
}
