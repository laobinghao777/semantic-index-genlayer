# SemanticIndex

A reusable GenLayer semantic-identity index. Applications that collect incident reports, event submissions or catalog records need one canonical record even when users describe the same entity in different words. Exact hashes only detect byte-identical text; unconstrained LLM deduplication can silently merge distinct events.

## Design

The creator commits an immutable identity policy for each collection. Every new candidate is compared against **every** current canonical record, in a deterministic order. GenLayer consensus must agree on the same relation for each pair. The contract derives the outcome:

- All different: append a canonical record.
- Exactly one same, with no unknown: store an alias pointing to that canonical ID.
- Any unknown, or more than one matching canonical: record ambiguity and do not insert or merge.

Exact content resends are idempotent and do not call AI or create another decision. Canonical content is never replaced. Decisions retain their revision, content hash, full pairwise relations and compared canonical count. The contract never trusts the model to choose a canonical ID or mutate the registry. Only the collection creator may add records. Policies cannot be edited; a different identity definition needs a new collection.

## Scope and limits

Bounded prototype: 12 canonical records and 24 decisions per collection, 1600 characters per candidate. Every candidate is checked against the complete current index; it does not silently truncate comparison candidates. This is not an embedding search engine or a proof of real-world identity. AI can misclassify and early canonical choices affect later results. Ambiguous submissions are immutable and exact resends are idempotent; resolve them with a new, clarified submission or collection. No external identity facts, authentication or production usage are claimed. Do not store private data on a public chain.

## Reproduce

Node.js 20+, Python 3.12+. Run `npm install --ignore-scripts` and `python tests.py`. Place a dedicated test key in ignored local `pk.txt`. Use `node scripts/run.mjs create_case <name> <policy>`, then `node scripts/run.mjs add_entry <collection-id> <content>`. Reads use `get_case` and `list_cases`. Run `node scripts/run.mjs` for a read-only snapshot. The SDK tracks finality, settled test-GEN costs, pending operations and network identity. A signer lock prevents simultaneous operations. Never upload private keys or logs. No frontend is required by this standalone primitive.

Verified on Bradbury Phase 2 (chain 4221). Contract 0x211376d052267FE82655ef3B58f4c7C04759B614. A real collection has one canonical Paris outage record and a differently worded alias pointing to canonical 1. All operations finalized. See demo-result.json for exact state. Total net cost including deployment: 0.000374030320008468 GEN. Create/add/add workflow: 0.000250324220006351 GEN.\n\n- deploy: https://scan.bradbury.genlayer.com/tx/0xb5ab2559e4da703278deec54ef01159c3ba1d6bcd22a172a14851d36115b7b0e\n- create_case: https://scan.bradbury.genlayer.com/tx/0x4623f9607eba6ea7671a93a51edef110e82b06cb3cc05ff278d6d3f328965600\n- add_entry: https://scan.bradbury.genlayer.com/tx/0x6bbca99389a5c068df3c401284a4bf5202a0c97733d2a419f455533b0918b970\n- add_entry: https://scan.bradbury.genlayer.com/tx/0x00eb4a3d71a2e94f7ce20f20d6f1b4628e58ff12593fc0692dee55e8818a6b24 No Portal approval or points are claimed.
