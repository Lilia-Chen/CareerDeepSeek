# ADR-001: Public code repo with repo-external private assets

## Status

Accepted

## Date

2026-05-10

## Context

DeepJobSeek should showcase coding and agent workflow engineering publicly. The surrounding AIcareer workspace contains private career assets, including CVs, cover letters, coaching materials, company notes, tracker references, and future contact records.

The project needs a structure that supports public GitHub visibility without exposing personal assets or third-party personal data.

## Decision

Create `AIcareer/DeepJobSeek` as an independent public-ready git repository. Keep real assets in a repo-external private data directory referenced by `DEEPJOBSEEK_DATA_DIR`.

## Alternatives considered

### Make all of AIcareer a public repo

- Pros: Simple single repository.
- Cons: High risk of publishing private assets.
- Rejected because AIcareer already contains private and semi-private materials.

### Use two GitHub repositories, one public and one private

- Pros: Clear separation and backup for private data.
- Cons: Too much process for the first version.
- Rejected for MVP. A private data repo can be added later if needed.

### Use one public repo with a local private data directory

- Pros: Simple, public code is easy to show, private assets stay out of git.
- Cons: Private data needs separate backup discipline.
- Accepted for MVP.

## Consequences

- Public fixtures must be synthetic or anonymized.
- Scripts must read real data only from `DEEPJOBSEEK_DATA_DIR`.
- `.gitignore` must block common private data directories and asset formats.
- GitHub remote creation requires a privacy review before push.

