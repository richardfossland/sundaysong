# Decisions

Lightweight ADRs. Newest first.

---

## ADR-001 — TypeScript 7 via `@typescript/native`; `typescript` står på 6.0-API-et; Next bruker API-typesjekkeren

- **Status:** accepted
- **Fasit:** full begrunnelse i sundayquiz `docs/DECISIONS.md` ADR-001
  (PR richardfossland/sundayquiz#29). Kort versjon her.

Rot-`package.json` har to aliaser:

```json
"@typescript/native": "npm:typescript@~7.0.2",
"typescript":         "npm:@typescript/typescript6@^6.0.2"
```

- `node_modules/.bin/tsc` er TS 7 (den native kompilatoren). `pnpm typecheck`
  og CI kjører den. Den autoritative typesjekken.
- `require("typescript")` er TS 6.0-API-et, for verktøy som trenger TS sitt
  JS-API (Next, og typescript-eslint hvis det legges til; det kaster på TS >= 7,
  typescript-eslint#10940).
- **`"typescript": "npm:@typescript/typescript6@..."` er ikke en nedgradering.**
  Ikke «fiks» den tilbake til `^7`.
- Workspace-pakkene deklarerer ikke `typescript` selv; de arver aliasene fra
  roten. Egen `typescript`-linje i en pakke ville gitt den en annen `tsc`.
- **`experimental.useTypeScriptCli: false` i `apps/web/next.config.mjs` og
  `apps/admin/next.config.mjs` er lastbærende.** TS 6-kompatpakken har
  binæren `tsc6`, ikke `tsc`, så Nexts standard CLI-typesjekk finner ingenting å
  starte og `next build` feiler. Fjern den ikke.
- Når typescript-eslint støtter TS >= 7.1 kan begge aliasene bli til én
  `"typescript": "^7"`, og `useTypeScriptCli` kan fjernes.
