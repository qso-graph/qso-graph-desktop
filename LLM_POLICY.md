# AI-Assisted Contributions Policy

QSO Graph Desktop is built largely with AI coding agents. This policy sets out how that work is
held to the same standard as any other, and what we expect from contributors who use AI tools.

## The principles

1. **A person is accountable.** Every change is made under the direction of a person who answers
   for it. For the project's own agents, that's the project lead.
2. **The specification rules.** AI-written code meets `spec/QGD-SPEC-001.md` like any other code,
   and "the model wrote it" is never a reason to accept a defect.
3. **Independent review before commit.** No AI-written change is committed on its author's word.
   A coder, a checker and a reviewer, each a different model or a person, look at it first, and
   the full `make verify` gate passes. The roles are described in [AGENTS.md](AGENTS.md).
4. **Tests prove, they don't decorate.** Every check must be shown to fail when the defect it
   guards against is present. AI agents are particularly prone to tests that pass while checking
   nothing.
5. **No invented facts.** Claims about outside services, standards, rules or versions are checked
   against the source (its documentation, its live endpoint, the published standard) and cited.
   Unknowns are stated as unknown.
6. **Some acts are reserved for people.** Agents never sign off a Part, approve a screenshot
   baseline, publish a release, or act under a person's account.

## Secrets and data

- **Agents never handle real credentials.** Tests use synthetic values in their own namespace.
  When debugging, print an allowlist of fields, never "everything except the secret".
- **Agents don't touch other products' data**, on disk or in the credential store.
- **No operator data** (logs, personas, credentials) is ever sent to an AI service for development
  purposes.

## For outside contributors using AI tools

You're welcome to use AI tools. You're responsible for what you submit:
- understand and be able to explain every line;
- make sure it meets the spec and passes `make verify`;
- don't submit code or text the tool may have copied from sources with incompatible licences;
- say in your pull request that AI tools were used and how.

## Attribution

Commits made with AI assistance carry a `Co-Authored-By` line naming the model.
