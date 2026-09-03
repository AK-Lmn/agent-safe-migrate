# Contributing to Migration Guardian (`mgcheck`)

Thank you for your interest in contributing to Migration Guardian! We welcome community contributions to make database migrations safer for everyone.

## Development Setup

### Prerequisites
- **Node.js**: v18 or later
- **npm**: v9 or later
- **Docker**: (Optional, for running full-fidelity Docker Postgres tests)

### Getting Started

1. **Clone the repository:**
   ```bash
   git clone https://github.com/yourusername/mgcheck.git
   cd mgcheck
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Run tests:**
   ```bash
   # Run all unit and integration tests (uses in-memory PGlite)
   npm test

   # Run type checks
   npm run lint
   ```

4. **Build the CLI:**
   ```bash
   npm run build
   ```

5. **Test the CLI locally:**
   ```bash
   # Using tsx directly in development
   npm run dev -- analyze ./test/fixtures/migrations/unsafe-create-index.sql

   # Or link globally
   npm link
   mgcheck analyze ./test/fixtures/migrations/unsafe-create-index.sql
   ```

## Adding a New Rule

Migration Guardian rules live in `src/analyzer/rules/`. To add a new rule:

1. Create a new rule file in `src/analyzer/rules/<rule-name>.ts`.
2. Implement the `Rule` interface:
   ```typescript
   export const myNewRule: Rule = {
     id: 'MG011',
     name: 'my-new-rule',
     severity: 'warning', // or 'error'
     description: 'Brief description of what this checks',
     check(statements: ParsedStatement[], context: RuleContext): RuleViolation[] {
       // Inspect statements and return any violations
     },
   };
   ```
3. Register the rule in `src/analyzer/rules/index.ts`.
4. Add unit test coverage in `test/unit/rules.test.ts`.
5. Update the rules table in `README.md`.

## Code Guidelines
- Write TypeScript in strict mode.
- Use explicit types for public APIs.
- Keep rules deterministic and document the plain-English explanation for why the operation is dangerous and what the safe alternative is.
- Ensure all tests pass (`npm test`) before opening a pull request.

## Pull Request Process
1. Create a feature branch: `git checkout -b feat/my-feature`
2. Commit your changes with clear messages following Conventional Commits.
3. Ensure CI passes and all tests are green.
4. Open a Pull Request describing your changes and link any related issues.
