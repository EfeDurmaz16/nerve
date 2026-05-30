# Could-Have-Been-Cheaper Analyzer

The analyzer reads TokenOps request traces and reports:

- overkill model calls
- prefix cache opportunities
- cache opportunities
- repeated context signals

CLI hint:

```bash
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts analyze
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts analyze --trace <id>
```

HTTP endpoint:

```bash
GET /analyze
GET /analyze?trace=<id>
```
