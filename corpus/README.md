# Evaluation Corpus

This directory will contain the synthetic Polish legal-document corpus used to measure detection quality.

Planned format: JSONL, one document per line:

```json
{"id":"doc-001","text":"...","entities":[{"start":0,"end":10,"category":"PERSON"}]}
```

The corpus must use fictional data only.

