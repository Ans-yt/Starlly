# ADR-0007: Evaluation data is versioned JSONL; rebooking ships baseline-first

- **Status:** Accepted
- **Context:** Spec §7.1/§12 promised evaluation but didn't fix a data format; §7.2 promised a learned rebooking model on synthetic data.
- **Decision:**
  - Evaluation records are JSONL files under `fixtures/eval/`, versioned by filename (`reviews.v1.jsonl`), each record carrying: text, language, theme labels, sentiment label, and provenance. Evaluation data is kept separate from sample/demo data and from training data.
  - Theme tagging and sentiment are evaluated separately; results are reported as plain counts/accuracy per theme.
  - Rebooking: implement the service-interval rule baseline first, shown beside (or instead of) any learned output. Learned probabilities are enabled only when sufficient real service history and outcome labels exist to evaluate them; otherwise the UI shows the clearly labeled rule-based recommendation. Synthetic-data models are never presented as accurate.
- **Consequences:** The predictor cannot silently overclaim; eval runs are reproducible from committed fixtures.