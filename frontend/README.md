# find_home frontend

Angular (standalone components, signals, zoneless) + Bootstrap 5 + MapLibre GL + CodeMirror 6.
Talks to the FastAPI backend through the dev-server proxy (`proxy.conf.json` → http://127.0.0.1:8200); no BFF.

```bash
npm ci
npx ng serve --port 4400 --proxy-config proxy.conf.json   # or VS Code task "FH: ng serve"
npx ng test --watch=false                                 # vitest
npx ng build
```

Pages live in `src/app/pages/` (one file each, inline templates), API access in `src/app/services/api.service.ts`,
shared response shapes in `src/app/models.ts`.
