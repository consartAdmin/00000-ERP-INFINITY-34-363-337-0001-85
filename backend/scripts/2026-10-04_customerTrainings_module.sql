-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║ 2026-10-04 — Módulo Treinamentos de Clientes                         ║
-- ║ Registra o módulo 145 no menu/permissões                             ║
-- ║ - As tabelas customerTrainings / customerTrainingAttendees são       ║
-- ║   criadas automaticamente pela API (customerTrainingsSchema)         ║
-- ║ - Libera o módulo para quem já acessa 📋 Listagem de Clientes (4)    ║
-- ║ - Aditivo e idempotente: pode ser executado mais de uma vez          ║
-- ╚══════════════════════════════════════════════════════════════════════╝

BEGIN;

-- 1) Cadastro do módulo ("moduleSystem".id não tem constraint única → sem ON CONFLICT)
UPDATE public."moduleSystem"
   SET name = '🎓 Treinamentos de Clientes', path = '../customerTrainings/customerTrainings.html', is_active = TRUE
 WHERE id = 145;

INSERT INTO public."moduleSystem" (id, name, path, is_active)
SELECT 145, '🎓 Treinamentos de Clientes', '../customerTrainings/customerTrainings.html', TRUE
 WHERE NOT EXISTS (SELECT 1 FROM public."moduleSystem" WHERE id = 145);

-- 2) Permissão para os usuários que já acessam a Listagem de Clientes
INSERT INTO public."userModules" (usuario_id, modulo_id, pode_acessar)
SELECT um.usuario_id, 145, TRUE
  FROM public."userModules" um
 WHERE um.modulo_id = 4
   AND um.pode_acessar = TRUE
   AND NOT EXISTS (
     SELECT 1 FROM public."userModules" x
      WHERE x.usuario_id = um.usuario_id AND x.modulo_id = 145
   );

COMMIT;
