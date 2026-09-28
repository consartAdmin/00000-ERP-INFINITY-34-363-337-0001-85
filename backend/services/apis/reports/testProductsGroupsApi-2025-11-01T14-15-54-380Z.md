# Relatório — testProductsGroupsApi
**Quando:** 2025-11-01T14:15:54.375Z  
**Host:** Renato-Moreira  
**Node:** v22.15.1  
**Duração total:** 1342 ms

## Resultado
- **Criados:** 106
- **Upsertados:** 100, 103
- **Atualizado ID:** 106
- **Desativado ID:** 103
- **Removido ID:** 109
- **Qtd final:** 19

## Etapas
- ✅ **ensureProductsGroupsTable()** — 421 ms
- ✅ **list() — início** — 182 ms
- ✅ **create({ name: "Limpeza" })** — 35 ms
- ✅ **create({ name: "Higiene Pessoal" })** — 44 ms
- ✅ **upsertByName({ name: "Limpeza", is_active: true })** — 40 ms
- ✅ **upsertByName({ name: "Descartáveis", is_active: true })** — 35 ms
- ✅ **list({ q: "limp" })** — 175 ms
- ✅ **getById(100)** — 33 ms
- ❌ **update(106, { name: "Cuidados Pessoais" })** — 39 ms
- ✅ **update(106, { is_active: true })** — 36 ms
- ✅ **deactivate(103)** — 34 ms
- ✅ **upsertByName({ name: "Para Remover", is_active: true })** — 43 ms
- ✅ **remove(109)** — 33 ms
- ✅ **list() — final** — 184 ms

---
_Gerado automaticamente por `testProductsGroupsApi.js`._
