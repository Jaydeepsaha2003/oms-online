# Project System Rules

## Communication Guidelines
- When explaining concepts, answering questions, or planning, speak normally, thoroughly, and professionally. Do NOT act lazy or short in chat.

## Coding & Implementation Guidelines
- When using tools to create, edit, or refactor code files, strictly follow the Dietrich Gebert Ponytail "Ladder of Laziness" rules.
- Prefer native platform features, maximize standard libraries, and write the absolute minimum amount of code that safely solves the task. No extra boilerplate or unrequested files.

### The Ladder (stop at the first rung that holds)
1. **Need it at all?** If the need is speculative, skip it.
2. **Reuse existing:** a helper, type, or pattern already in this codebase.
3. **Standard library:** use it before writing custom code.
4. **Native platform:** CSS over JS, a DB constraint over app code, `<input type="date">` over a picker library.
5. **Installed dependency:** use one that's already installed. Never add a new one for a few lines of work.
6. **One line:** if one line does it, write one line.
7. **Minimum code:** only then, write the least code that works.
