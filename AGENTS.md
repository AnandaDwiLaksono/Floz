# FLOZ knowledge retrieval

- Current repository code and tests, including relevant uncommitted changes, establish implemented behavior. Official FLOZ specifications govern their respective product, API, database, architecture, and UI contracts; surface conflicts rather than silently reconciling them.
- Consult Obsidian only for relevant project history, engineering rationale, prior debugging lessons, or cross-module decisions. Historical notes provide context, not proof of current behavior; test existence does not prove execution or success.
- Resolve `OBSIDIAN_VAULT_PATH` through the Hermes Obsidian Skill using the supported terminal runtime. Never preload the Vault. Search relevant filenames/headings, then read focused sections; skip retrieval when existing evidence suffices.
- Reuse valid retrieved context; refresh when relevant evidence changes or becomes unavailable. Expand investigation whenever security, RBAC, workspace isolation, debugging, or QA needs more evidence; impose no arbitrary retrieval limits.
- Update Obsidian only with explicit authorization and verified new knowledge; reuse canonical notes to avoid duplicates. Never automatically synchronize the repository, inject Vault knowledge into persistent memory, or store secrets in knowledge notes.
