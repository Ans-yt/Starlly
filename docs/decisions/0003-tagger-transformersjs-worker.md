# ADR-0003: Theme/sentiment tagger runs Transformers.js in a backend worker thread

- **Status:** Accepted
- **Context:** Spec §7.1 left the tagger's home open ("browser or local server"). Inference must not block API requests, and multilingual review text is expected.
- **Decision:**
  - Transformers.js (`@huggingface/transformers`) on the backend, inside a `worker_threads` worker so inference never blocks requests.
  - Embedding model: `Xenova/paraphrase-multilingual-MiniLM-L12-v2`.
  - Cache model files on disk (`models/`, git-ignored) and cache embeddings keyed by text hash.
  - Theme tagging = cosine similarity of review embedding vs. theme-description embeddings, plus a small classifier for consistent counts. Sentiment is evaluated separately from themes.
  - Embedding similarity is never presented as a calibrated probability; UI labels it as a similarity score.
  - Counts come from the tagger, not the LLM, so numbers do not drift.
- **Consequences:** First run downloads the model once; offline after that. Evaluation runs against versioned JSONL records (ADR-0007).