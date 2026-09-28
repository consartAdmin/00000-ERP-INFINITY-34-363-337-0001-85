-- Reverte o zeramento de chart_account_id em public."accountsReceivable".
-- Gerado em 2026-09-16. Restaura exatamente os valores anteriores.
BEGIN;
UPDATE public."accountsReceivable" SET chart_account_id = 2 WHERE id = 2;
UPDATE public."accountsReceivable" SET chart_account_id = 16 WHERE id = 16;
UPDATE public."accountsReceivable" SET chart_account_id = 17 WHERE id = 17;
UPDATE public."accountsReceivable" SET chart_account_id = 41 WHERE id = 41;
UPDATE public."accountsReceivable" SET chart_account_id = 42 WHERE id = 42;
UPDATE public."accountsReceivable" SET chart_account_id = 43 WHERE id = 43;
UPDATE public."accountsReceivable" SET chart_account_id = 68 WHERE id = 68;
UPDATE public."accountsReceivable" SET chart_account_id = 69 WHERE id = 69;
UPDATE public."accountsReceivable" SET chart_account_id = 70 WHERE id = 70;
UPDATE public."accountsReceivable" SET chart_account_id = 116 WHERE id = 116;
UPDATE public."accountsReceivable" SET chart_account_id = 119 WHERE id = 119;
UPDATE public."accountsReceivable" SET chart_account_id = 120 WHERE id = 120;
UPDATE public."accountsReceivable" SET chart_account_id = 129 WHERE id = 129;
UPDATE public."accountsReceivable" SET chart_account_id = 139 WHERE id = 139;
UPDATE public."accountsReceivable" SET chart_account_id = 140 WHERE id = 140;
UPDATE public."accountsReceivable" SET chart_account_id = 141 WHERE id = 141;
UPDATE public."accountsReceivable" SET chart_account_id = 169 WHERE id = 169;
UPDATE public."accountsReceivable" SET chart_account_id = 170 WHERE id = 170;
UPDATE public."accountsReceivable" SET chart_account_id = 171 WHERE id = 171;
COMMIT;
