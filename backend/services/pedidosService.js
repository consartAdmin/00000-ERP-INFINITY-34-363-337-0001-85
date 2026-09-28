// backend/services/pedidosService.js
import { Pool } from "pg";

// Se já tem um pool no app, você pode exportar esse módulo de outra forma.
// Aqui vai um exemplo simples que cria um novo pool via DATABASE_URL:
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false },
});

export async function obterPedidoPorId(id) {
  // TODO: troque pelas suas tabelas reais e JOINs.
  // Este exemplo retorna um formato compatível com seu print.
  const cli = await pool.query(
    `select ... from clientes where id = (select cliente_id from pedidos where id = $1)`, [id]
  );
  const it = await pool.query(
    `select ... from pedidos_itens where pedido_id = $1 order by nItem`, [id]
  );
  const dup = await pool.query(
    `select parcela as "parcela", data_vencimento as "vencimento", valor
       from pedidos_duplicatas where pedido_id = $1 order by parcela`, [id]
  );

  // Monte o objeto de retorno exatamente como seu frontend espera:
  return {
    cliente: {/* ... */},
    itens:   it.rows.map(r => ({ /* ... */ })),
    totais:  {/* ... */},
    pedido:  { id },
    pagamento: { condicao: "7 dias", total: 19.5 },
    duplicatas: dup.rows,
  };
}
