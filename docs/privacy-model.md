# Privacy Model

CareerDeepSeek is intended to be a public repository.

## Public

The following can be committed:

- Source code.
- Public schemas.
- Synthetic fixtures.
- Synthetic expected results.
- Generic templates.
- Policy documentation.
- Architecture Decision Records.

## Private

The following must not be committed:

- Real job opportunities.
- Company research notes about real targets.
- Contact names, profiles, emails, handles, and messages.
- CVs and cover letters.
- Recruiter messages.
- Screenshots.
- Raw page text.
- Browser profiles.
- CRM exports.
- Self-improvement logs containing personal context.

## Data root

Use `CAREERDEEPSEEK_DATA_DIR` for private data.

Recommended local path:

```txt
../CareerDeepSeek-data
```

Generated target records are written under:

```txt
$CAREERDEEPSEEK_DATA_DIR/targets
```

Generated review queue items are written under:

```txt
$CAREERDEEPSEEK_DATA_DIR/review-queue
```

The repo must work without this directory for public tests and synthetic evals.

The runtime rejects `CAREERDEEPSEEK_DATA_DIR` values that resolve inside this public repository.
