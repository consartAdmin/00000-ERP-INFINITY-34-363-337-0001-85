-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║ 2026-09-23 — Módulo Entregas (Motoristas / Veículos / Rotas)          ║
-- ║ Registra o módulo 144 no menu/permissões                              ║
-- ║ - As tabelas drivers / vehicles / deliveryTrips / deliveryTripStops   ║
-- ║   são criadas automaticamente pela API (deliveryTripsSchema.js)       ║
-- ║ - Libera o módulo para quem já acessa 🚚 Logística (69)               ║
-- ║ - Aditivo e idempotente: pode ser executado mais de uma vez          ║
-- ╚══════════════════════════════════════════════════════════════════════╝

BEGIN;

-- 1) Cadastro do módulo ("moduleSystem".id não tem constraint única → sem ON CONFLICT)
UPDATE public."moduleSystem"
   SET name = '🚛 Entregas e Motoristas', path = '../deliveryTrips/deliveryTrips.html', is_active = TRUE
 WHERE id = 144;

INSERT INTO public."moduleSystem" (id, name, path, is_active)
SELECT 144, '🚛 Entregas e Motoristas', '../deliveryTrips/deliveryTrips.html', TRUE
 WHERE NOT EXISTS (SELECT 1 FROM public."moduleSystem" WHERE id = 144);

-- 2) Permissão para os usuários que já acessam Logística
INSERT INTO public."userModules" (usuario_id, modulo_id, pode_acessar)
SELECT um.usuario_id, 144, TRUE
  FROM public."userModules" um
 WHERE um.modulo_id = 69
   AND um.pode_acessar = TRUE
   AND NOT EXISTS (
     SELECT 1 FROM public."userModules" x
      WHERE x.usuario_id = um.usuario_id AND x.modulo_id = 144
   );

COMMIT;
